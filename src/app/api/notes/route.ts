import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireWorkspaceRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import {
  buildWorkspaceGraph,
  ensureAllWorkspacesIndexed,
  extractWorkspaceTasks,
  findRelatedNotes,
  findUnlinkedMentions,
  indexSingleFile,
  removeFileFromIndex,
  resolveWorkspaceLinkTargets,
} from "@/lib/indexer";
import {
  CortexQueryResult,
  executeCortexQuery,
  extractCortexQueryBlocks,
} from "@/lib/dataview";
import {
  extractHeadingSection,
  parseTransclusionTargets,
} from "@/lib/render-rich";
import {
  NOTE_TEMPLATES,
  normalizeRelPath,
  resolveVaultPath,
  writeMarkdownFile,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  root_path: string;
}

interface NoteRow {
  id: string;
  workspace_id: string;
  rel_path: string;
  title: string;
  folder: string;
  object_type: string;
  frontmatter_json: string;
  tags_json: string;
  body: string;
  word_count: number;
  sha256: string;
  is_favorite: number;
  is_pinned: number;
  is_trashed: number;
  mtime_ms: number;
  created_at: number;
  updated_at: number;
}

function getWorkspace(slug?: string | null): WorkspaceRow | undefined {
  const db = getDb();
  if (slug) {
    return db
      .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE slug = ?")
      .get(slug) as WorkspaceRow | undefined;
  }
  return db
    .prepare("SELECT id, slug, name, root_path FROM workspaces ORDER BY created_at ASC LIMIT 1")
    .get() as WorkspaceRow | undefined;
}

function sanitizeNoteFilename(title: string): string {
  const cleaned = title
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  return cleaned || `Untitled-${Date.now().toString(36)}`;
}

function serializeNoteSummary(n: Omit<NoteRow, "body">) {
  return {
    id: n.id,
    workspaceId: n.workspace_id,
    relPath: n.rel_path,
    title: n.title,
    folder: n.folder,
    objectType: n.object_type,
    frontmatter: JSON.parse(n.frontmatter_json || "{}") as Record<string, unknown>,
    tags: JSON.parse(n.tags_json || "[]") as string[],
    wordCount: n.word_count,
    sha256: n.sha256,
    isFavorite: Boolean(n.is_favorite),
    isPinned: Boolean(n.is_pinned),
    isTrashed: Boolean(n.is_trashed),
    mtimeMs: n.mtime_ms,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  ensureAllWorkspacesIndexed();
  const db = getDb();

  const workspaceSlug = req.nextUrl.searchParams.get("workspaceSlug");
  const ws = getWorkspace(workspaceSlug);
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const noteId = req.nextUrl.searchParams.get("noteId");
  const relPath = req.nextUrl.searchParams.get("relPath");

  if (noteId || relPath) {
    const note = (
      noteId
        ? db
            .prepare("SELECT * FROM notes WHERE id = ? AND workspace_id = ?")
            .get(noteId, ws.id)
        : db
            .prepare("SELECT * FROM notes WHERE rel_path = ? AND workspace_id = ?")
            .get(normalizeRelPath(relPath!), ws.id)
    ) as NoteRow | undefined;

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const headings = db
      .prepare(
        "SELECT id, level, text, slug, start_line, end_line FROM note_headings WHERE note_id = ? ORDER BY start_line ASC",
      )
      .all(note.id);

    const outgoingLinks = db
      .prepare(
        `SELECT nl.id, nl.target_raw, nl.target_norm, nl.target_note_id, nl.alias, nl.heading, nl.line_number,
                tn.rel_path as target_rel_path, tn.title as target_title
         FROM note_links nl
         LEFT JOIN notes tn ON tn.id = nl.target_note_id
         WHERE nl.source_note_id = ?
         ORDER BY nl.line_number ASC`,
      )
      .all(note.id);

    const fileStem = note.rel_path.split("/").pop()?.replace(/\.md$/i, "") || note.title;
    const backlinks = db
      .prepare(
        `SELECT nl.id, nl.source_note_id, nl.source_path, n.title as source_title,
                nl.heading, nl.line_number, nl.context_snippet, nl.target_raw
         FROM note_links nl
         JOIN notes n ON n.id = nl.source_note_id
         WHERE nl.workspace_id = ? AND n.is_trashed = 0 AND nl.source_note_id != ?
           AND (nl.target_note_id = ? OR LOWER(nl.target_norm) = LOWER(?) OR LOWER(nl.target_norm) = LOWER(?))
         ORDER BY n.updated_at DESC`,
      )
      .all(ws.id, note.id, note.id, note.title, fileStem);

    const unlinkedMentions = findUnlinkedMentions(ws.id, note.id);
    const relatedNotes = findRelatedNotes(ws.id, note.id, 6);
    const versions = db
      .prepare(
        `SELECT id, sha256, summary, created_by, created_at, length(content) as size_bytes, content
         FROM note_versions
         WHERE note_id = ?
         ORDER BY created_at DESC
         LIMIT 25`,
      )
      .all(note.id);

    const fullGraph = buildWorkspaceGraph(ws.id);
    const neighborIds = new Set<string>([note.id]);
    for (const edge of fullGraph.edges) {
      if (edge.source === note.id) neighborIds.add(edge.target);
      if (edge.target === note.id) neighborIds.add(edge.source);
    }
    const localGraph = {
      nodes: fullGraph.nodes.filter((n) => neighborIds.has(n.id)),
      edges: fullGraph.edges.filter(
        (e) => neighborIds.has(e.source) && neighborIds.has(e.target),
      ),
    };

    const transclusionTargets = parseTransclusionTargets(note.body);
    const transclusions: Record<
      string,
      {
        raw: string;
        found: boolean;
        noteId?: string;
        relPath?: string;
        title?: string;
        heading?: string;
        content: string;
      }
    > = {};

    if (transclusionTargets.length > 0) {
      const wsNotes = db
        .prepare(
          "SELECT id, rel_path, title, body FROM notes WHERE workspace_id = ? AND is_trashed = 0",
        )
        .all(ws.id) as unknown as Array<{
        id: string;
        rel_path: string;
        title: string;
        body: string;
      }>;

      for (const reqT of transclusionTargets) {
        const keyLower = reqT.target.toLowerCase();
        const targetNote = wsNotes.find((cand) => {
          if (cand.id === note.id) return false;
          const noExt = cand.rel_path.replace(/\.md$/i, "");
          const stem = noExt.split("/").pop() || noExt;
          return (
            cand.title.toLowerCase() === keyLower ||
            stem.toLowerCase() === keyLower ||
            noExt.toLowerCase() === keyLower
          );
        });

        if (!targetNote) {
          transclusions[reqT.raw] = {
            raw: reqT.raw,
            found: false,
            heading: reqT.heading,
            content: "",
          };
          continue;
        }

        const section = extractHeadingSection(targetNote.body, reqT.heading);
        transclusions[reqT.raw] = {
          raw: reqT.raw,
          found: reqT.heading ? section.length > 0 : true,
          noteId: targetNote.id,
          relPath: targetNote.rel_path,
          title: targetNote.title,
          heading: reqT.heading,
          content: section,
        };
      }
    }

    const queryBlocks = extractCortexQueryBlocks(note.body);
    const queryResults: Record<string, CortexQueryResult> = {};
    for (const qText of queryBlocks) {
      if (!queryResults[qText]) {
        queryResults[qText] = executeCortexQuery(ws.id, qText);
      }
    }

    return NextResponse.json({
      workspace: ws,
      note: {
        ...serializeNoteSummary(note),
        body: note.body,
      },
      headings,
      outgoingLinks,
      backlinks,
      unlinkedMentions,
      relatedNotes,
      versions,
      localGraph,
      transclusions,
      queryResults,
    });
  }

  const includeTrashed = req.nextUrl.searchParams.get("includeTrashed") === "true";
  const rows = db
    .prepare(
      `SELECT id, workspace_id, rel_path, title, folder, object_type, frontmatter_json, tags_json,
              word_count, sha256, is_favorite, is_pinned, is_trashed, mtime_ms, created_at, updated_at
       FROM notes
       WHERE workspace_id = ? ${includeTrashed ? "" : "AND is_trashed = 0"}
       ORDER BY is_pinned DESC, is_favorite DESC, updated_at DESC`,
    )
    .all(ws.id) as Array<Omit<NoteRow, "body">>;

  const notes = rows.map(serializeNoteSummary);
  const view = req.nextUrl.searchParams.get("view");
  const pathFrom = req.nextUrl.searchParams.get("pathFrom") || undefined;
  const pathTo = req.nextUrl.searchParams.get("pathTo") || undefined;

  const tagCounts = new Map<string, number>();
  const folders = new Set<string>();
  for (const n of notes) {
    if (!n.isTrashed) {
      if (n.folder) folders.add(n.folder);
      for (const t of n.tags) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
  }

  const graph = buildWorkspaceGraph(ws.id, { pathFrom, pathTo });
  const orphanIds = graph.nodes.filter((n) => n.isOrphan).map((n) => n.id);

  return NextResponse.json({
    workspace: ws,
    notes,
    folders: Array.from(folders).sort(),
    tags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    orphanIds,
    ...(view === "graph" ? { graph } : {}),
    ...(view === "tasks" ? { tasks: extractWorkspaceTasks(ws.id) } : {}),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    action?: "create" | "daily";
    workspaceSlug?: string;
    title?: string;
    folder?: string;
    relPath?: string;
    templateId?: string;
    content?: string;
    date?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const ws = getWorkspace(body.workspaceSlug);
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const rbacPost = requireWorkspaceRole(auth.session, ws.id, "editor");
  if ("error" in rbacPost) {
    return NextResponse.json({ error: rbacPost.error }, { status: rbacPost.status });
  }

  const db = getDb();
  const requestedDate =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())
      ? body.date.trim()
      : new Date().toISOString().slice(0, 10);

  if (body.action === "daily") {
    const dailyRel = `journals/${requestedDate}.md`;
    const existing = db
      .prepare("SELECT * FROM notes WHERE workspace_id = ? AND rel_path = ?")
      .get(ws.id, dailyRel) as NoteRow | undefined;

    if (existing) {
      if (existing.is_trashed) {
        db.prepare("UPDATE notes SET is_trashed = 0 WHERE id = ?").run(existing.id);
      }
      return NextResponse.json({
        note: { ...serializeNoteSummary(existing), isTrashed: false, body: existing.body },
        created: false,
      });
    }

    const dailyTpl = NOTE_TEMPLATES.find((t) => t.id === "daily")!;
    const initialContent = dailyTpl.content(`Daily Note - ${requestedDate}`, requestedDate);
    writeMarkdownFile(ws.root_path, dailyRel, initialContent);
    const noteId = indexSingleFile(ws.id, dailyRel, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:created",
      workspaceSlug: ws.slug,
      relPath: dailyRel,
      noteId: noteId || undefined,
    });
    const createdNote = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId) as unknown as NoteRow;
    return NextResponse.json(
      {
        note: { ...serializeNoteSummary(createdNote), body: createdNote.body },
        created: true,
      },
      { status: 201 },
    );
  }

  const template = NOTE_TEMPLATES.find((t) => t.id === body.templateId) || NOTE_TEMPLATES[0];
  const title = (body.title || "Untitled Note").trim();
  const folder = (body.folder ?? template.folder ?? "").trim().replace(/^\/+|\/+$/g, "");

  let relPath: string;
  try {
    if (body.relPath) {
      const candidate = body.relPath.endsWith(".md") ? body.relPath : `${body.relPath}.md`;
      relPath = normalizeRelPath(candidate);
    } else {
      const fileName = `${sanitizeNoteFilename(title)}.md`;
      relPath = normalizeRelPath(folder ? `${folder}/${fileName}` : fileName);
    }
    const targetFull = resolveVaultPath(ws.root_path, relPath);
    if (fs.existsSync(targetFull)) {
      const parsedPath = path.posix.parse(relPath);
      const uniqueName = `${parsedPath.name}-${Date.now().toString(36).slice(-4)}.md`;
      relPath = parsedPath.dir ? `${parsedPath.dir}/${uniqueName}` : uniqueName;
      resolveVaultPath(ws.root_path, relPath);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid note path" },
      { status: 400 },
    );
  }

  const finalContent =
    body.content !== undefined ? body.content : template.content(title, requestedDate);

  writeMarkdownFile(ws.root_path, relPath, finalContent);
  const noteId = indexSingleFile(ws.id, relPath, { force: true });
  resolveWorkspaceLinkTargets(ws.id);
  broadcastEvent({
    type: "note:created",
    workspaceSlug: ws.slug,
    relPath,
    noteId: noteId || undefined,
  });

  const created = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId) as unknown as NoteRow;
  return NextResponse.json(
    { note: { ...serializeNoteSummary(created), body: created.body } },
    { status: 201 },
  );
}

export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    action?:
      | "save"
      | "toggleFavorite"
      | "togglePin"
      | "trash"
      | "restore"
      | "linkMention"
      | "toggleTask"
      | "updateTask"
      | "restoreVersion"
      | "rename";
    workspaceSlug?: string;
    noteId?: string;
    relPath?: string;
    content?: string;
    baseSha256?: string;
    forceOverwrite?: boolean;
    summary?: string;
    // action-specific params
    sourceNoteId?: string;
    lineNumber?: number;
    matchedTerm?: string;
    targetTitle?: string;
    versionId?: string;
    newRelPath?: string;
    status?: "todo" | "doing" | "done";
    priority?: "A" | "B" | "C" | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const db = getDb();
  const action = body.action || "save";

  if (action === "linkMention") {
    const sourceId = body.sourceNoteId || body.noteId;
    if (!sourceId || !body.lineNumber || !body.matchedTerm || !body.targetTitle) {
      return NextResponse.json(
        { error: "sourceNoteId, lineNumber, matchedTerm, and targetTitle are required" },
        { status: 400 },
      );
    }
    const sourceNote = db.prepare("SELECT * FROM notes WHERE id = ?").get(sourceId) as
      | NoteRow
      | undefined;
    if (!sourceNote) {
      return NextResponse.json({ error: "Source note not found" }, { status: 404 });
    }
    const ws = db
      .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE id = ?")
      .get(sourceNote.workspace_id) as unknown as WorkspaceRow;

    const rbacMention = requireWorkspaceRole(auth.session, ws.id, "editor");
    if ("error" in rbacMention) {
      return NextResponse.json(
        { error: rbacMention.error },
        { status: rbacMention.status },
      );
    }

    const lines = sourceNote.body.split(/\r?\n/);
    const idx = body.lineNumber - 1;
    if (idx < 0 || idx >= lines.length) {
      return NextResponse.json({ error: "Invalid line number" }, { status: 400 });
    }

    const escaped = body.matchedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkSyntax =
      body.matchedTerm.toLowerCase() === body.targetTitle.toLowerCase()
        ? `[[${body.targetTitle}]]`
        : `[[${body.targetTitle}|${body.matchedTerm}]]`;

    const updatedLine = lines[idx].replace(new RegExp(`\\b${escaped}\\b`), linkSyntax);
    lines[idx] = updatedLine;
    const newContent = lines.join("\n");

    db.prepare(
      `INSERT INTO note_versions (id, note_id, workspace_id, rel_path, sha256, content, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      sourceNote.id,
      ws.id,
      sourceNote.rel_path,
      sourceNote.sha256,
      sourceNote.body,
      `Before linking [[${body.targetTitle}]]`,
      auth.session.username,
      Date.now(),
    );

    writeMarkdownFile(ws.root_path, sourceNote.rel_path, newContent);
    indexSingleFile(ws.id, sourceNote.rel_path, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: sourceNote.rel_path,
      noteId: sourceNote.id,
    });

    return NextResponse.json({ ok: true, sourceNoteId: sourceNote.id });
  }

  let note: NoteRow | undefined;
  if (body.noteId) {
    note = db.prepare("SELECT * FROM notes WHERE id = ?").get(body.noteId) as
      | NoteRow
      | undefined;
  } else if (body.workspaceSlug && body.relPath) {
    const ws = getWorkspace(body.workspaceSlug);
    if (ws) {
      note = db
        .prepare("SELECT * FROM notes WHERE workspace_id = ? AND rel_path = ?")
        .get(ws.id, normalizeRelPath(body.relPath)) as NoteRow | undefined;
    }
  }

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const rbacDel = requireWorkspaceRole(auth.session, note.workspace_id, "editor");
  if ("error" in rbacDel) {
    return NextResponse.json({ error: rbacDel.error }, { status: rbacDel.status });
  }

  const ws = db
    .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE id = ?")
    .get(note.workspace_id) as unknown as WorkspaceRow;

  if (action === "toggleFavorite") {
    const nextVal = note.is_favorite ? 0 : 1;
    db.prepare("UPDATE notes SET is_favorite = ? WHERE id = ?").run(nextVal, note.id);
    return NextResponse.json({ isFavorite: Boolean(nextVal) });
  }

  if (action === "togglePin") {
    const nextVal = note.is_pinned ? 0 : 1;
    db.prepare("UPDATE notes SET is_pinned = ? WHERE id = ?").run(nextVal, note.id);
    return NextResponse.json({ isPinned: Boolean(nextVal) });
  }

  if (action === "trash") {
    db.prepare("UPDATE notes SET is_trashed = 1, is_pinned = 0 WHERE id = ?").run(note.id);
    broadcastEvent({
      type: "note:deleted",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });
    return NextResponse.json({ isTrashed: true });
  }

  if (action === "restore") {
    db.prepare("UPDATE notes SET is_trashed = 0 WHERE id = ?").run(note.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });
    return NextResponse.json({ isTrashed: false });
  }

  if (action === "toggleTask") {
    if (!body.lineNumber) {
      return NextResponse.json({ error: "lineNumber is required" }, { status: 400 });
    }
    const lines = note.body.split(/\r?\n/);
    const idx = body.lineNumber - 1;
    if (idx < 0 || idx >= lines.length) {
      return NextResponse.json({ error: "Invalid line number" }, { status: 400 });
    }
    const line = lines[idx];
    let updated = line;
    if (/^(\s*[-*]\s+)\[ \](\s+.+)$/.test(line)) {
      updated = line.replace(/^(\s*[-*]\s+)\[ \](\s+.+)$/, "$1[x]$2");
    } else if (/^(\s*[-*]\s+)\[[xX]\](\s+.+)$/.test(line)) {
      updated = line.replace(/^(\s*[-*]\s+)\[[xX]\](\s+.+)$/, "$1[ ]$2");
    } else if (/^(\s*[-*]?\s*)(TODO|DOING|NOW|LATER)(\s+.+)$/.test(line)) {
      updated = line.replace(/^(\s*[-*]?\s*)(TODO|DOING|NOW|LATER)(\s+.+)$/, "$1DONE$3");
    } else if (/^(\s*[-*]?\s*)DONE(\s+.+)$/.test(line)) {
      updated = line.replace(/^(\s*[-*]?\s*)DONE(\s+.+)$/, "$1TODO$2");
    }
    lines[idx] = updated;
    const newContent = lines.join("\n");

    writeMarkdownFile(ws.root_path, note.rel_path, newContent);
    indexSingleFile(ws.id, note.rel_path, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });
    const fresh = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as unknown as NoteRow;
    return NextResponse.json({
      note: { ...serializeNoteSummary(fresh), body: fresh.body },
    });
  }

  if (action === "updateTask") {
    if (!body.lineNumber) {
      return NextResponse.json({ error: "lineNumber is required" }, { status: 400 });
    }
    const lines = note.body.split(/\r?\n/);
    const idx = body.lineNumber - 1;
    if (idx < 0 || idx >= lines.length) {
      return NextResponse.json({ error: "Invalid line number" }, { status: 400 });
    }
    let line = lines[idx];
    const targetStatus = body.status;

    if (/^(\s*[-*]\s+)\[([ xX])\](\s+.+)$/.test(line)) {
      const m = /^(\s*[-*]\s+)\[([ xX])\]\s+(.+)$/.exec(line)!;
      const prefix = m[1];
      let textPart = m[3];
      let box = m[2];
      if (targetStatus === "done") {
        box = "x";
        textPart = textPart.replace(/\s+#doing\b/gi, "");
      } else if (targetStatus === "doing") {
        box = " ";
        if (!/#doing\b/i.test(textPart)) {
          textPart = `${textPart.trimEnd()} #doing`;
        }
      } else if (targetStatus === "todo") {
        box = " ";
        textPart = textPart.replace(/\s+#doing\b/gi, "");
      }
      if (body.priority !== undefined) {
        textPart = textPart.replace(/^\[#(A|B|C)\]\s*/i, "");
        if (body.priority) {
          textPart = `[#${body.priority}] ${textPart}`;
        }
      }
      line = `${prefix}[${box}] ${textPart.trim()}`;
    } else if (/^(\s*[-*]?\s*)(TODO|DOING|NOW|LATER|DONE)\s+(.+)$/.test(line)) {
      const m = /^(\s*[-*]?\s*)(TODO|DOING|NOW|LATER|DONE)\s+(.+)$/.exec(line)!;
      const prefix = m[1];
      let kw = m[2];
      let textPart = m[3];
      if (targetStatus === "done") kw = "DONE";
      else if (targetStatus === "doing") kw = "DOING";
      else if (targetStatus === "todo") kw = "TODO";
      if (body.priority !== undefined) {
        textPart = textPart.replace(/^\[#(A|B|C)\]\s*/i, "");
        if (body.priority) {
          textPart = `[#${body.priority}] ${textPart}`;
        }
      }
      line = `${prefix}${kw} ${textPart.trim()}`;
    } else {
      return NextResponse.json({ error: "Line is not a recognized task" }, { status: 400 });
    }

    lines[idx] = line;
    const newContent = lines.join("\n");
    writeMarkdownFile(ws.root_path, note.rel_path, newContent);
    indexSingleFile(ws.id, note.rel_path, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });
    const fresh = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as unknown as NoteRow;
    return NextResponse.json({
      note: { ...serializeNoteSummary(fresh), body: fresh.body },
    });
  }

  if (action === "restoreVersion") {
    if (!body.versionId) {
      return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    }
    const ver = db
      .prepare("SELECT * FROM note_versions WHERE id = ? AND note_id = ?")
      .get(body.versionId, note.id) as
      | { id: string; content: string; created_at: number }
      | undefined;
    if (!ver) {
      return NextResponse.json({ error: "Version snapshot not found" }, { status: 404 });
    }

    db.prepare(
      `INSERT INTO note_versions (id, note_id, workspace_id, rel_path, sha256, content, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      note.id,
      ws.id,
      note.rel_path,
      note.sha256,
      note.body,
      "Snapshot before version restore",
      auth.session.username,
      Date.now(),
    );

    writeMarkdownFile(ws.root_path, note.rel_path, ver.content);
    indexSingleFile(ws.id, note.rel_path, { force: true });
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });

    const fresh = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as unknown as NoteRow;
    return NextResponse.json({
      note: { ...serializeNoteSummary(fresh), body: fresh.body },
    });
  }

  if (action === "rename") {
    if (!body.newRelPath) {
      return NextResponse.json({ error: "newRelPath is required" }, { status: 400 });
    }
    let nextRel: string;
    let oldFull: string;
    let nextFull: string;
    try {
      nextRel = normalizeRelPath(
        body.newRelPath.endsWith(".md") ? body.newRelPath : `${body.newRelPath}.md`,
      );
      oldFull = resolveVaultPath(ws.root_path, note.rel_path);
      nextFull = resolveVaultPath(ws.root_path, nextRel);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid target path" },
        { status: 400 },
      );
    }

    if (fs.existsSync(nextFull) && nextRel !== note.rel_path) {
      return NextResponse.json({ error: "Destination file already exists" }, { status: 409 });
    }

    const oldRel = note.rel_path;
    const oldTitle = note.title;
    const oldRelNoExt = oldRel.replace(/\.md$/i, "");
    const oldStem = path.posix.basename(oldRel, ".md");
    const newRelNoExt = nextRel.replace(/\.md$/i, "");
    const newStem = path.posix.basename(nextRel, ".md");

    fs.mkdirSync(path.dirname(nextFull), { recursive: true });
    if (fs.existsSync(oldFull)) {
      fs.renameSync(oldFull, nextFull);
    } else {
      fs.writeFileSync(nextFull, note.body, "utf8");
    }

    const folder = path.posix.dirname(nextRel) === "." ? "" : path.posix.dirname(nextRel);
    db.prepare("UPDATE notes SET rel_path = ?, folder = ? WHERE id = ?").run(
      nextRel,
      folder,
      note.id,
    );
    indexSingleFile(ws.id, nextRel, { force: true });

    // Item 5: Refactor backlinks across non-trashed notes in the workspace
    let refactoredBacklinksCount = 0;
    let updatedReferrerCount = 0;
    if (oldRelNoExt.toLowerCase() !== newRelNoExt.toLowerCase()) {
      const oldCandidates = new Set(
        [oldStem, oldTitle, oldRelNoExt]
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      );
      const otherNotes = db
        .prepare(
          "SELECT id, rel_path, body FROM notes WHERE workspace_id = ? AND is_trashed = 0 AND id != ?",
        )
        .all(ws.id, note.id) as unknown as Array<{
        id: string;
        rel_path: string;
        body: string;
      }>;

      for (const refNote of otherNotes) {
        const lines = refNote.body.split("\n");
        let inFence = false;
        let noteChangedCount = 0;

        const nextLines = lines.map((line) => {
          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
          }
          if (inFence) return line;

          return line.replace(/(!?\[\[)([^\]\n]+?)(\]\])/g, (full, open: string, inner: string, close: string) => {
            const pipeIdx = inner.indexOf("|");
            const linkCore = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
            const aliasSuffix = pipeIdx === -1 ? "" : inner.slice(pipeIdx);
            const hashIdx = linkCore.indexOf("#");
            const rawTarget = (hashIdx === -1 ? linkCore : linkCore.slice(0, hashIdx)).trim();
            const headingSuffix = hashIdx === -1 ? "" : linkCore.slice(hashIdx);

            const targetLower = rawTarget.toLowerCase();
            if (!oldCandidates.has(targetLower)) {
              return full;
            }

            const replacementTarget = rawTarget.includes("/") ? newRelNoExt : newStem;
            if (replacementTarget === rawTarget) {
              return full;
            }

            noteChangedCount += 1;
            return `${open}${replacementTarget}${headingSuffix}${aliasSuffix}${close}`;
          });
        });

        if (noteChangedCount > 0) {
          const updatedBody = nextLines.join("\n");
          writeMarkdownFile(ws.root_path, refNote.rel_path, updatedBody);
          indexSingleFile(ws.id, refNote.rel_path, { force: true });
          refactoredBacklinksCount += noteChangedCount;
          updatedReferrerCount += 1;
          broadcastEvent({
            type: "note:updated",
            workspaceSlug: ws.slug,
            relPath: refNote.rel_path,
            noteId: refNote.id,
          });
        }
      }
    }

    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:updated",
      workspaceSlug: ws.slug,
      relPath: nextRel,
      noteId: note.id,
    });

    const fresh = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as unknown as NoteRow;
    return NextResponse.json({
      note: { ...serializeNoteSummary(fresh), body: fresh.body },
      refactoredBacklinksCount,
      updatedReferrerCount,
    });
  }

  // Default "save" action
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  // Optimistic concurrency check against latest disk/DB SHA-256
  let currentDiskContent = note.body;
  try {
    const fullPath = resolveVaultPath(ws.root_path, note.rel_path);
    if (fs.existsSync(fullPath)) {
      indexSingleFile(ws.id, note.rel_path);
      const refreshed = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as
        | NoteRow
        | undefined;
      if (refreshed) {
        note = refreshed;
        currentDiskContent = refreshed.body;
      }
    }
  } catch {
    // Keep DB state if path check failed
  }

  if (body.baseSha256 && body.baseSha256 !== note.sha256 && !body.forceOverwrite) {
    return NextResponse.json(
      {
        error: "Sync conflict: this note was modified elsewhere since you loaded it.",
        code: "CONFLICT",
        serverSha256: note.sha256,
        serverContent: currentDiskContent,
        serverUpdatedAt: note.updated_at,
      },
      { status: 409 },
    );
  }

  if (body.content !== note.body) {
    db.prepare(
      `INSERT INTO note_versions (id, note_id, workspace_id, rel_path, sha256, content, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      note.id,
      ws.id,
      note.rel_path,
      note.sha256,
      note.body,
      body.summary || "Manual edit",
      auth.session.username,
      Date.now(),
    );
  }

  writeMarkdownFile(ws.root_path, note.rel_path, body.content);
  indexSingleFile(ws.id, note.rel_path, { force: true });
  resolveWorkspaceLinkTargets(ws.id);
  broadcastEvent({
    type: "note:updated",
    workspaceSlug: ws.slug,
    relPath: note.rel_path,
    noteId: note.id,
  });

  const updated = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as unknown as NoteRow;
  return NextResponse.json({
    note: { ...serializeNoteSummary(updated), body: updated.body },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const noteId = req.nextUrl.searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "noteId query parameter is required" }, { status: 400 });
  }

  const db = getDb();
  const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId) as
    | NoteRow
    | undefined;
  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const rbacDel = requireWorkspaceRole(auth.session, note.workspace_id, "editor");
  if ("error" in rbacDel) {
    return NextResponse.json({ error: rbacDel.error }, { status: rbacDel.status });
  }

  const ws = db
    .prepare("SELECT id, slug, root_path FROM workspaces WHERE id = ?")
    .get(note.workspace_id) as { id: string; slug: string; root_path: string } | undefined;

  if (ws) {
    try {
      const fullPath = resolveVaultPath(ws.root_path, note.rel_path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // Ignore if file already missing on disk
    }
    removeFileFromIndex(ws.id, note.rel_path);
    resolveWorkspaceLinkTargets(ws.id);
    broadcastEvent({
      type: "note:deleted",
      workspaceSlug: ws.slug,
      relPath: note.rel_path,
      noteId: note.id,
    });
  }

  return NextResponse.json({ ok: true, deletedId: note.id });
}
