import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import {
  findRelatedNotes,
  findUnlinkedMentions,
  indexSingleFile,
  resolveWorkspaceLinkTargets,
} from "@/lib/indexer";
import {
  computeSha256,
  normalizeRelPath,
  resolveVaultPath,
  writeMarkdownFile,
} from "@/lib/storage";
import { isPathPermittedForAi } from "./acl";
import { extractConceptTags } from "./embeddings";
import { RagCitation, retrieveGroundedChunks } from "./rag";

export type AgentToolName =
  | "create_note"
  | "edit_note"
  | "organize_note"
  | "update_metadata"
  | "auto_link_notes";

export interface PendingActionProposal {
  id: string;
  conversationId: string;
  workspaceId: string;
  toolName: AgentToolName;
  args: Record<string, unknown>;
  previewDiff: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
}

/** Generate a readable line-level unified diff preview for human approval. */
export function createUnifiedDiff(
  relPath: string,
  beforeText: string,
  afterText: string,
): string {
  const beforeLines = beforeText ? beforeText.split(/\r?\n/) : [];
  const afterLines = afterText ? afterText.split(/\r?\n/) : [];
  const header = [`--- a/${relPath}`, `+++ b/${relPath}`];

  const out: string[] = [...header];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (i < 3 || i > maxLen - 4) out.push(`  ${b}`);
      continue;
    }
    if (b !== undefined) out.push(`- ${b}`);
    if (a !== undefined) out.push(`+ ${a}`);
  }
  return out.slice(0, 120).join("\n");
}

function logAiAudit(input: {
  workspaceId: string;
  conversationId?: string | null;
  providerId: string;
  toolName: string;
  targetPath: string;
  actionStatus: string;
  details: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_audit_logs (id, workspace_id, conversation_id, provider_id, tool_name, target_path, action_status, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.workspaceId,
    input.conversationId || null,
    input.providerId,
    input.toolName,
    input.targetPath,
    input.actionStatus,
    JSON.stringify(input.details),
    Date.now(),
  );
}

/** Propose a controlled file mutation into ai_pending_actions (never writes disk directly). */
export function proposeAgentAction(input: {
  conversationId: string;
  workspaceId: string;
  providerId: string;
  toolName: AgentToolName;
  args: Record<string, unknown>;
}): PendingActionProposal {
  const db = getDb();
  const ws = db
    .prepare("SELECT id, root_path FROM workspaces WHERE id = ?")
    .get(input.workspaceId) as { id: string; root_path: string } | undefined;
  if (!ws) throw new Error("Workspace not found");

  const relPath = normalizeRelPath(String(input.args.relPath || ""));
  if (!isPathPermittedForAi(input.workspaceId, relPath)) {
    logAiAudit({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      providerId: input.providerId,
      toolName: input.toolName,
      targetPath: relPath,
      actionStatus: "blocked_by_acl",
      details: { reason: "Folder denied by AI ACL rules" },
    });
    throw new Error(`AI access to "${relPath}" is blocked by folder ACL policy.`);
  }

  const targetFull = resolveVaultPath(ws.root_path, relPath);
  const existingContent = fs.existsSync(targetFull)
    ? fs.readFileSync(targetFull, "utf8")
    : "";

  let nextContent = existingContent;
  let diffPath = relPath;

  if (input.toolName === "create_note") {
    if (fs.existsSync(targetFull)) {
      throw new Error(`Note "${relPath}" already exists.`);
    }
    nextContent = String(input.args.content || "");
  } else if (input.toolName === "edit_note") {
    nextContent = String(input.args.content || "");
  } else if (input.toolName === "organize_note") {
    const destPath = normalizeRelPath(String(input.args.destinationPath || ""));
    if (!isPathPermittedForAi(input.workspaceId, destPath)) {
      throw new Error(`Destination "${destPath}" is blocked by folder ACL policy.`);
    }
    resolveVaultPath(ws.root_path, destPath);
    diffPath = `${relPath} -> ${destPath}`;
    nextContent = existingContent;
  } else if (input.toolName === "update_metadata") {
    const parsed = matter(existingContent);
    const data = { ...(parsed.data || {}) } as Record<string, unknown>;
    if (Array.isArray(input.args.addTags)) {
      const curr = Array.isArray(data.tags) ? data.tags.map(String) : [];
      data.tags = Array.from(new Set([...curr, ...input.args.addTags.map(String)]));
    }
    if (typeof input.args.objectType === "string" && input.args.objectType.trim()) {
      data.type = input.args.objectType.trim();
    }
    if (input.args.properties && typeof input.args.properties === "object") {
      Object.assign(data, input.args.properties);
    }
    nextContent = matter.stringify(parsed.content, data);
  } else if (input.toolName === "auto_link_notes") {
    nextContent = String(input.args.content || existingContent);
  }

  const previewDiff =
    input.toolName === "organize_note"
      ? `MOVE ${relPath} -> ${String(input.args.destinationPath)}\n(Preserves content & updates links)`
      : createUnifiedDiff(diffPath, existingContent, nextContent);

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_pending_actions (id, conversation_id, workspace_id, tool_name, args_json, preview_diff, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
  ).run(
    id,
    input.conversationId,
    input.workspaceId,
    input.toolName,
    JSON.stringify({ ...input.args, relPath, proposedContent: nextContent }),
    previewDiff,
    now,
  );

  logAiAudit({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    providerId: input.providerId,
    toolName: input.toolName,
    targetPath: relPath,
    actionStatus: "proposed",
    details: { actionId: id },
  });

  return {
    id,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    toolName: input.toolName,
    args: { ...input.args, relPath },
    previewDiff,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/** Approve and execute a pending AI agent action with snapshot + audit log. */
export function approvePendingAction(actionId: string): {
  action: PendingActionProposal;
  appliedPath: string;
} {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM ai_pending_actions WHERE id = ?")
    .get(actionId) as
    | {
        id: string;
        conversation_id: string;
        workspace_id: string;
        tool_name: AgentToolName;
        args_json: string;
        preview_diff: string;
        status: "pending" | "approved" | "rejected";
        created_at: number;
        resolved_at: number | null;
      }
    | undefined;

  if (!row) throw new Error("Pending action not found");
  if (row.status !== "pending") throw new Error(`Action already ${row.status}`);

  const ws = db
    .prepare("SELECT id, slug, root_path FROM workspaces WHERE id = ?")
    .get(row.workspace_id) as { id: string; slug: string; root_path: string } | undefined;
  if (!ws) throw new Error("Workspace not found");

  const args = JSON.parse(row.args_json) as Record<string, unknown>;
  const relPath = normalizeRelPath(String(args.relPath || ""));

  if (!isPathPermittedForAi(ws.id, relPath)) {
    throw new Error(`Blocked by AI folder ACL policy: ${relPath}`);
  }

  const fullPath = resolveVaultPath(ws.root_path, relPath);
  let finalPath = relPath;

  if (row.tool_name === "organize_note") {
    const destPath = normalizeRelPath(String(args.destinationPath || ""));
    if (!isPathPermittedForAi(ws.id, destPath)) {
      throw new Error(`Destination blocked by AI folder ACL policy: ${destPath}`);
    }
    const destFull = resolveVaultPath(ws.root_path, destPath);
    if (!fs.existsSync(fullPath)) throw new Error("Source note no longer exists");
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    fs.renameSync(fullPath, destFull);
    db.prepare("UPDATE notes SET rel_path = ?, folder = ? WHERE workspace_id = ? AND rel_path = ?").run(
      destPath,
      path.posix.dirname(destPath) === "." ? "" : path.posix.dirname(destPath),
      ws.id,
      relPath,
    );
    indexSingleFile(ws.id, destPath, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    finalPath = destPath;
  } else {
    const proposedContent = String(args.proposedContent || "");
    if (fs.existsSync(fullPath)) {
      const prevContent = fs.readFileSync(fullPath, "utf8");
      const existingNote = db
        .prepare("SELECT id FROM notes WHERE workspace_id = ? AND rel_path = ?")
        .get(ws.id, relPath) as { id: string } | undefined;
      if (existingNote) {
        db.prepare(
          `INSERT INTO note_versions (id, note_id, workspace_id, rel_path, sha256, content, summary, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ai-agent', ?)`,
        ).run(
          crypto.randomUUID(),
          existingNote.id,
          ws.id,
          relPath,
          computeSha256(prevContent),
          prevContent,
          `Pre-AI snapshot before ${row.tool_name}`,
          Date.now(),
        );
      }
    }
    writeMarkdownFile(ws.root_path, relPath, proposedContent);
    const noteId = indexSingleFile(ws.id, relPath, { force: true });
    broadcastEvent({
      type: row.tool_name === "create_note" ? "note:created" : "note:updated",
      workspaceSlug: ws.slug,
      relPath,
      noteId: noteId || undefined,
    });
  }

  const resolvedAt = Date.now();
  db.prepare("UPDATE ai_pending_actions SET status = 'approved', resolved_at = ? WHERE id = ?").run(
    resolvedAt,
    row.id,
  );

  logAiAudit({
    workspaceId: ws.id,
    conversationId: row.conversation_id,
    providerId: "agent",
    toolName: row.tool_name,
    targetPath: finalPath,
    actionStatus: "approved_and_applied",
    details: { actionId: row.id },
  });

  broadcastEvent({
    type: "ai:action_resolved",
    workspaceSlug: ws.slug,
    relPath: finalPath,
    actionId: row.id,
  });

  return {
    appliedPath: finalPath,
    action: {
      id: row.id,
      conversationId: row.conversation_id,
      workspaceId: row.workspace_id,
      toolName: row.tool_name,
      args,
      previewDiff: row.preview_diff,
      status: "approved",
      createdAt: row.created_at,
      resolvedAt,
    },
  };
}

/** Reject a pending AI agent action and record audit entry. */
export function rejectPendingAction(actionId: string): void {
  const db = getDb();
  const row = db
    .prepare("SELECT id, conversation_id, workspace_id, tool_name, args_json, status FROM ai_pending_actions WHERE id = ?")
    .get(actionId) as
    | {
        id: string;
        conversation_id: string;
        workspace_id: string;
        tool_name: string;
        args_json: string;
        status: string;
      }
    | undefined;
  if (!row) throw new Error("Pending action not found");
  if (row.status !== "pending") return;

  db.prepare("UPDATE ai_pending_actions SET status = 'rejected', resolved_at = ? WHERE id = ?").run(
    Date.now(),
    actionId,
  );
  const args = JSON.parse(row.args_json) as { relPath?: string };
  logAiAudit({
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    providerId: "agent",
    toolName: row.tool_name,
    targetPath: args.relPath || "",
    actionStatus: "rejected",
    details: { actionId },
  });
}

/**
 * Inspect user prompt intent and generate safe, approval-gated agent proposals
 * (e.g. summarize into a note, auto-link unlinked mentions, tag metadata, draft docs).
 */
export function planAgentProposalsFromPrompt(input: {
  prompt: string;
  workspaceId: string;
  conversationId: string;
  providerId: string;
  activeNoteId?: string;
  citations: RagCitation[];
}): { proposals: PendingActionProposal[]; summaryNote?: string } {
  const db = getDb();
  const lower = input.prompt.toLowerCase();
  const proposals: PendingActionProposal[] = [];

  // 1. Auto-link unlinked mentions or related notes for the active note
  if (/(auto-?link|add links|link notes|connect.*notes)/.test(lower) && input.activeNoteId) {
    const active = db
      .prepare("SELECT id, rel_path, title, body FROM notes WHERE id = ? AND workspace_id = ?")
      .get(input.activeNoteId, input.workspaceId) as
      | { id: string; rel_path: string; title: string; body: string }
      | undefined;
    if (active && isPathPermittedForAi(input.workspaceId, active.rel_path)) {
      const related = findRelatedNotes(input.workspaceId, active.id, 3);
      let updatedBody = active.body;
      let linksAdded = 0;

      // Also link any direct note titles mentioned in plain text inside this note
      const allNotes = db
        .prepare("SELECT id, title, rel_path FROM notes WHERE workspace_id = ? AND id != ? AND is_trashed = 0")
        .all(input.workspaceId, active.id) as Array<{ id: string; title: string; rel_path: string }>;

      for (const other of allNotes) {
        if (other.title.length < 4 || !isPathPermittedForAi(input.workspaceId, other.rel_path)) continue;
        const alreadyLinked = updatedBody.includes(`[[${other.title}]]`);
        if (alreadyLinked) continue;
        const escaped = other.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rx = new RegExp(`(?<!\\[\\[)\\b(${escaped})\\b(?!\\]\\])`);
        if (rx.test(updatedBody)) {
          updatedBody = updatedBody.replace(rx, `[[${other.title}]]`);
          linksAdded++;
        }
      }

      if (linksAdded === 0 && related.length > 0) {
        const additions = related
          .filter((r) => !updatedBody.includes(`[[${r.title}]]`))
          .map((r) => `- [[${r.title}]] (similarity ${Math.round(r.score * 100)}%)`);
        if (additions.length > 0) {
          updatedBody = `${updatedBody.trimEnd()}\n\n## AI Suggested Connections\n${additions.join("\n")}\n`;
          linksAdded = additions.length;
        }
      }

      if (linksAdded > 0 && updatedBody !== active.body) {
        proposals.push(
          proposeAgentAction({
            conversationId: input.conversationId,
            workspaceId: input.workspaceId,
            providerId: input.providerId,
            toolName: "auto_link_notes",
            args: {
              relPath: active.rel_path,
              content: updatedBody,
              linksAdded,
            },
          }),
        );
      }
    }
  }

  // 2. Summarize or draft project documentation into a new structured Markdown note
  if (/(create.*note|summarize.*into|draft.*doc|generate.*doc|write.*summary)/.test(lower)) {
    const today = new Date().toISOString().slice(0, 10);
    const topicSlug = input.prompt
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(" ");
    const safeTitle = topicSlug || `AI Synthesis ${today}`;
    const relPath = `Research/${safeTitle}.md`;
    const sources = input.citations.length > 0
      ? input.citations
      : retrieveGroundedChunks(input.prompt, {
          mode: "workspace",
          workspaceId: input.workspaceId,
          limit: 5,
        });

    const bullets = sources
      .map(
        (c) =>
          `- **[[${c.title}]]** (\`${c.relPath}#L${c.startLine}-L${c.endLine}\`): ${c.snippet.replace(/\s+/g, " ").slice(0, 220)}`,
      )
      .join("\n");

    const content = `---
type: literature
created: ${today}
tags: [ai-synthesis, summary]
---

# ${safeTitle}

## Synthesized Overview
Generated by CortexMD AI Agent from ${sources.length} permitted source section(s).

## Key Findings & References
${bullets || "- No matching sources found."}

## Follow-up Actions
- [ ] Review synthesized links and refine structure
`;

    try {
      proposals.push(
        proposeAgentAction({
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          toolName: "create_note",
          args: { relPath, content },
        }),
      );
    } catch {
      // ignore if file already exists
    }
  }

  // 3. Add tags / metadata to active note when requested
  if (/(add tag|update metadata|tag this|classify)/.test(lower) && input.activeNoteId) {
    const active = db
      .prepare("SELECT rel_path, title, body FROM notes WHERE id = ? AND workspace_id = ?")
      .get(input.activeNoteId, input.workspaceId) as
      | { rel_path: string; title: string; body: string }
      | undefined;
    if (active && isPathPermittedForAi(input.workspaceId, active.rel_path)) {
      const explicitTags = Array.from(input.prompt.matchAll(/#([a-zA-Z0-9_-]+)/g)).map((m) =>
        m[1].toLowerCase(),
      );
      const inferred = explicitTags.length > 0 ? explicitTags : ["ai-curated", "reviewed"];
      proposals.push(
        proposeAgentAction({
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          toolName: "update_metadata",
          args: {
            relPath: active.rel_path,
            addTags: inferred,
          },
        }),
      );
    }
  }

  // Also enrich with unlinked mention check summary if applicable
  let summaryNote: string | undefined;
  if (input.activeNoteId) {
    const unlinked = findUnlinkedMentions(input.workspaceId, input.activeNoteId);
    if (unlinked.length > 0 && proposals.length === 0 && /link|mention/.test(lower)) {
      summaryNote = `Found ${unlinked.length} unlinked mention(s) of this note across the workspace.`;
    }
  }

  return { proposals, summaryNote };
}

/**
 * Item 14: Vault Gardener — Scans permitted notes in a workspace for
 * unlinked mentions, untagged notes, and disconnected orphans, queueing
 * approval-gated diff proposals without ever modifying files directly.
 */
export function runVaultGardener(
  workspaceId: string,
  providerId = "local-hybrid",
): {
  proposals: PendingActionProposal[];
  stats: {
    scannedNotes: number;
    unlinkedProposed: number;
    taggingProposed: number;
    orphanBridgesProposed: number;
  };
} {
  const db = getDb();
  const notes = db
    .prepare(
      "SELECT id, rel_path, title, object_type, tags_json, body FROM notes WHERE workspace_id = ? AND is_trashed = 0",
    )
    .all(workspaceId) as Array<{
    id: string;
    rel_path: string;
    title: string;
    object_type: string;
    tags_json: string;
    body: string;
  }>;

  const permitted = notes.filter((n) => isPathPermittedForAi(workspaceId, n.rel_path));
  const pendingRows = db
    .prepare(
      "SELECT tool_name, args_json FROM ai_pending_actions WHERE workspace_id = ? AND status = 'pending'",
    )
    .all(workspaceId) as Array<{ tool_name: string; args_json: string }>;

  const alreadyPendingKeys = new Set<string>();
  for (const r of pendingRows) {
    try {
      const parsed = JSON.parse(r.args_json) as Record<string, unknown>;
      if (parsed.relPath) {
        alreadyPendingKeys.add(`${r.tool_name}:${String(parsed.relPath)}`);
      }
    } catch {
      // ignore invalid row
    }
  }

  const proposals: PendingActionProposal[] = [];
  let unlinkedProposed = 0;
  let taggingProposed = 0;
  let orphanBridgesProposed = 0;

  // Pass 1: Auto-link unlinked mentions
  for (const target of permitted) {
    if (proposals.length >= 10) break;
    const mentions = findUnlinkedMentions(workspaceId, target.id);
    for (const m of mentions) {
      if (!isPathPermittedForAi(workspaceId, m.sourcePath)) continue;
      const key = `auto_link_notes:${m.sourcePath}`;
      if (alreadyPendingKeys.has(key)) continue;

      const srcNote = permitted.find((p) => p.id === m.sourceNoteId);
      if (!srcNote) continue;
      const lines = srcNote.body.split(/\r?\n/);
      const idx = m.lineNumber - 1;
      if (idx < 0 || idx >= lines.length) continue;

      const escaped = m.matchedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const replacementLink =
        m.matchedTerm.toLowerCase() === target.title.toLowerCase()
          ? `[[${target.title}]]`
          : `[[${target.title}|${m.matchedTerm}]]`;
      const updatedLine = lines[idx].replace(new RegExp(`\\b${escaped}\\b`), replacementLink);
      if (updatedLine === lines[idx]) continue;

      lines[idx] = updatedLine;
      try {
        const p = proposeAgentAction({
          conversationId: "",
          workspaceId,
          providerId,
          toolName: "auto_link_notes",
          args: {
            relPath: m.sourcePath,
            content: lines.join("\n"),
            linkedTo: target.title,
          },
        });
        proposals.push(p);
        alreadyPendingKeys.add(key);
        unlinkedProposed += 1;
        break;
      } catch {
        // skip errors
      }
    }
  }

  // Pass 2: Suggest semantic tags on untagged notes
  for (const n of permitted) {
    if (proposals.length >= 10) break;
    let existingTags: string[] = [];
    try {
      existingTags = JSON.parse(n.tags_json || "[]") as string[];
    } catch {
      existingTags = [];
    }
    if (existingTags.length > 0) continue;
    const key = `update_metadata:${n.rel_path}`;
    if (alreadyPendingKeys.has(key)) continue;

    const concepts = extractConceptTags(`${n.title}\n${n.body.slice(0, 2000)}`).slice(0, 3);
    if (concepts.length === 0) continue;

    try {
      const p = proposeAgentAction({
        conversationId: "",
        workspaceId,
        providerId,
        toolName: "update_metadata",
        args: {
          relPath: n.rel_path,
          addTags: concepts,
        },
      });
      proposals.push(p);
      alreadyPendingKeys.add(key);
      taggingProposed += 1;
    } catch {
      // skip errors
    }
  }

  // Pass 3: Suggest Related Links on orphan notes
  const linkedNoteIds = new Set<string>();
  const linkRows = db
    .prepare(
      "SELECT source_note_id, target_note_id FROM note_links WHERE workspace_id = ? AND target_note_id IS NOT NULL",
    )
    .all(workspaceId) as Array<{ source_note_id: string; target_note_id: string }>;
  for (const lr of linkRows) {
    linkedNoteIds.add(lr.source_note_id);
    linkedNoteIds.add(lr.target_note_id);
  }

  for (const n of permitted) {
    if (proposals.length >= 10) break;
    if (linkedNoteIds.has(n.id)) continue;
    const key = `edit_note:${n.rel_path}`;
    if (alreadyPendingKeys.has(key)) continue;

    const related = findRelatedNotes(workspaceId, n.id, 3).filter((r) =>
      isPathPermittedForAi(workspaceId, r.relPath),
    );
    if (related.length === 0) continue;

    const section = [
      "",
      "## Suggested Connections",
      ...related.map((r) => `- [[${r.title}]]`),
    ].join("\n");

    try {
      const p = proposeAgentAction({
        conversationId: "",
        workspaceId,
        providerId,
        toolName: "edit_note",
        args: {
          relPath: n.rel_path,
          content: `${n.body.trimEnd()}\n${section}\n`,
        },
      });
      proposals.push(p);
      alreadyPendingKeys.add(key);
      orphanBridgesProposed += 1;
    } catch {
      // skip errors
    }
  }

  return {
    proposals,
    stats: {
      scannedNotes: permitted.length,
      unlinkedProposed,
      taggingProposed,
      orphanBridgesProposed,
    },
  };
}
