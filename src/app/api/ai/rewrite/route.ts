import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isPathPermittedForAi } from "@/lib/ai/acl";
import { createUnifiedDiff } from "@/lib/ai/agent";
import { invokeExternalProvider, ProviderId } from "@/lib/ai/providers";
import { checkRateLimit, getClientKey, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

function splitNonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function deterministicRewrite(selectedText: string, instruction: string): string {
  const lower = instruction.toLowerCase();
  const trimmed = selectedText.replace(/\r\n/g, "\n").trim();

  if (/\b(task|checklist|todo)\b/.test(lower)) {
    const items = splitNonEmptyLines(trimmed).map(stripBulletPrefix);
    if (items.length <= 1 && /[.!?]\s+/.test(trimmed)) {
      return trimmed
        .split(/(?<=[.!?])\s+/)
        .map((s) => `- [ ] ${s.trim()}`)
        .join("\n");
    }
    return items.map((item) => `- [ ] ${item}`).join("\n");
  }

  if (/\b(bullet|bullets|list)\b/.test(lower)) {
    const lines = splitNonEmptyLines(trimmed);
    if (lines.length === 1 && /[,;]\s+/.test(lines[0]) && lines[0].length > 55) {
      return lines[0]
        .split(/[,;]\s+/)
        .map((part) => `- ${stripBulletPrefix(part)}`)
        .join("\n");
    }
    if (lines.length === 1 && /[.!?]\s+/.test(lines[0])) {
      return lines[0]
        .split(/(?<=[.!?])\s+/)
        .map((part) => `- ${stripBulletPrefix(part)}`)
        .join("\n");
    }
    return lines.map((line) => `- ${stripBulletPrefix(line)}`).join("\n");
  }

  if (/\b(table|tabular)\b/.test(lower)) {
    const lines = splitNonEmptyLines(trimmed).map(stripBulletPrefix);
    const rows = lines.map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0 && colonIdx < 48) {
        return [line.slice(0, colonIdx).trim(), line.slice(colonIdx + 1).trim()];
      }
      const dashParts = line.split(/\s+[—–-]{1,2}\s+/);
      if (dashParts.length >= 2) {
        return [dashParts[0].trim(), dashParts.slice(1).join(" - ").trim()];
      }
      const pipeParts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (pipeParts.length >= 2) {
        return [pipeParts[0], pipeParts.slice(1).join(" / ")];
      }
      return [line, "—"];
    });
    const tableLines = [
      "| Item | Details |",
      "| --- | --- |",
      ...rows.map(([k, v]) => `| ${k.replace(/\|/g, "\\|")} | ${v.replace(/\|/g, "\\|")} |`),
    ];
    return tableLines.join("\n");
  }

  if (/\b(callout|quote|highlight)\b/.test(lower)) {
    const quoted = trimmed
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `> [!NOTE] Key Takeaway\n${quoted}`;
  }

  if (/\b(concise|tighten|short|summarize|summary|tldr)\b/.test(lower)) {
    let compact = trimmed
      .replace(/\b(in order to)\b/gi, "to")
      .replace(/\b(due to the fact that|because of the fact that)\b/gi, "because")
      .replace(/\b(at this point in time)\b/gi, "now")
      .replace(/\b(basically|actually|really|very|quite|just)\s+/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (compact.length > 260) {
      const sentences = compact.split(/(?<=[.!?])\s+/);
      if (sentences.length > 3) {
        compact = sentences.slice(0, Math.max(2, Math.ceil(sentences.length / 2))).join(" ");
      }
    }
    return compact;
  }

  if (/\b(expand|elaborate|detail)\b/.test(lower)) {
    const baseLines = splitNonEmptyLines(trimmed);
    const titleHint = stripBulletPrefix(baseLines[0] || "Key Concept").replace(/[.!?]+$/, "");
    return [
      trimmed,
      "",
      `- **Why it matters:** Clarifies scope and dependencies around ${titleHint.slice(0, 64)}.`,
      "- **Verification:** Confirm linked notes, assumptions, and owner next steps.",
    ].join("\n");
  }

  if (/\b(polish|grammar|fix|clean|format)\b/.test(lower)) {
    return trimmed
      .split("\n")
      .map((line) => {
        const cleaned = line.replace(/[ \t]+$/g, "").replace(/[ \t]{2,}/g, " ");
        if (!cleaned) return "";
        if (/^(#{1,6}|[-*+]|\d+\.|>|```|\|)/.test(cleaned)) return cleaned;
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  // Fallback smart structure-preserving rewrite guided by custom instruction
  const normalized = trimmed
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  return `${normalized}\n\n<!-- AI Inline Edit (${instruction.slice(0, 60).replace(/-->/g, "")}) -->`;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "ai-rewrite"), 40, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Inline AI rewrite rate limit exceeded." },
      { status: 429 },
    );
  }

  let body: {
    workspaceSlug?: string;
    noteRelPath?: string;
    selectedText?: string;
    instruction?: string;
    providerId?: ProviderId;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const selectedText = typeof body.selectedText === "string" ? body.selectedText : "";
  const instruction = (body.instruction || "").trim() || "Polish clarity and grammar";
  if (!selectedText.trim()) {
    return NextResponse.json({ error: "selectedText is required" }, { status: 400 });
  }

  const db = getDb();
  const ws = body.workspaceSlug
    ? (db
        .prepare("SELECT id, slug FROM workspaces WHERE slug = ?")
        .get(body.workspaceSlug) as unknown as { id: string; slug: string } | undefined)
    : (db
        .prepare("SELECT id, slug FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as { id: string; slug: string } | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const relPath = (body.noteRelPath || "").trim();
  if (relPath && !isPathPermittedForAi(ws.id, relPath)) {
    return NextResponse.json(
      { error: "Folder AI policy denies AI access to this note path" },
      { status: 403 },
    );
  }

  const providerId: ProviderId = body.providerId || "local-hybrid";
  let replacementText = "";
  let modelUsed = "cortex-inline-local";
  let fallbackWarning: string | undefined;

  if (providerId === "local-hybrid") {
    replacementText = deterministicRewrite(selectedText, instruction);
  } else {
    try {
      const resp = await invokeExternalProvider(providerId, {
        systemPrompt:
          "You are an inline Markdown editor assistant. Rewrite ONLY the provided selection according to the user instruction. Preserve Markdown syntax and [[WikiLinks]]. Output ONLY the replacement Markdown text without surrounding code fences or commentary.",
        userPrompt: `Instruction: ${instruction}\n\nSelected Markdown:\n${selectedText}`,
        contextBlock: relPath ? `Target file: ${relPath}` : "",
      });
      replacementText = resp.text.trim() || deterministicRewrite(selectedText, instruction);
      modelUsed = resp.modelUsed;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Provider unavailable";
      fallbackWarning = `${providerId} unavailable (${reason}). Used deterministic local rewrite.`;
      replacementText = deterministicRewrite(selectedText, instruction);
    }
  }

  const diffPreview = createUnifiedDiff(
    relPath || "selection.md",
    selectedText,
    replacementText,
  );

  db.prepare(
    `INSERT INTO ai_audit_logs (id, workspace_id, conversation_id, provider_id, tool_name, target_path, action_status, details_json, created_at)
     VALUES (?, ?, NULL, ?, 'inline_rewrite', ?, 'completed', ?, ?)`,
  ).run(
    crypto.randomUUID(),
    ws.id,
    providerId,
    relPath || "(selection)",
    JSON.stringify({
      instruction,
      modelUsed,
      originalChars: selectedText.length,
      replacementChars: replacementText.length,
      fallbackUsed: Boolean(fallbackWarning),
    }),
    Date.now(),
  );

  return NextResponse.json({
    originalText: selectedText,
    replacementText,
    diffPreview,
    providerUsed: providerId,
    modelUsed,
    fallbackWarning,
  });
}
