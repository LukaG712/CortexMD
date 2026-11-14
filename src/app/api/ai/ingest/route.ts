import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isPathPermittedForAi } from "@/lib/ai/acl";
import { extractConceptTags } from "@/lib/ai/embeddings";
import { checkRateLimit, getClientKey, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import { indexSingleFile, resolveWorkspaceLinkTargets } from "@/lib/indexer";
import { normalizeRelPath, resolveVaultPath, writeMarkdownFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

function isPrivateOrDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^0\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h)
  ) {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractTitleFromHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (m) return decodeBasicEntities(m[1].replace(/\s+/g, " ").trim());
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return decodeBasicEntities(h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return "";
}

function htmlToCleanMarkdown(rawInput: string): string {
  const looksLikeHtml = /<(?:html|body|article|main|p|div|h[1-6]|li|section|br)\b/i.test(rawInput);
  if (!looksLikeHtml) {
    return rawInput.replace(/\r\n/g, "\n").trim();
  }

  let s = rawInput
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<svg[\s\S]*?>[\s\S]*?<\/svg>/gi, "\n")
    .replace(/<(?:nav|footer|aside)[\s\S]*?>[\s\S]*?<\/(?:nav|footer|aside)>/gi, "\n");

  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|blockquote|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");

  s = decodeBasicEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

function extractSummaryBullets(markdownBody: string): string[] {
  const sentences = markdownBody
    .replace(/^#+\s+.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28 && s.length <= 240);

  const unique: string[] = [];
  for (const s of sentences) {
    if (!unique.some((u) => u.toLowerCase() === s.toLowerCase())) {
      unique.push(s);
    }
    if (unique.length >= 4) break;
  }
  return unique.length > 0
    ? unique
    : ["Clipped source archived cleanly in Sources/ for semantic search & AI RAG."];
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "ai-ingest"), 25, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Source ingest rate limit exceeded." }, { status: 429 });
  }

  let body: {
    workspaceSlug?: string;
    title?: string;
    sourceUrl?: string;
    rawContent?: string;
    fetchUrl?: boolean;
    tags?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const db = getDb();
  const ws = body.workspaceSlug
    ? (db
        .prepare("SELECT id, slug, root_path FROM workspaces WHERE slug = ?")
        .get(body.workspaceSlug) as unknown as
        | { id: string; slug: string; root_path: string }
        | undefined)
    : (db
        .prepare("SELECT id, slug, root_path FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as
        | { id: string; slug: string; root_path: string }
        | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  let rawSource = (body.rawContent || "").trim();
  const sourceUrl = (body.sourceUrl || "").trim();
  let inferredHtmlTitle = "";

  if (!rawSource && body.fetchUrl && sourceUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return NextResponse.json({ error: "Invalid sourceUrl" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Only http/https URLs are permitted" }, { status: 400 });
    }
    if (isPrivateOrDisallowedHost(parsedUrl.hostname)) {
      return NextResponse.json(
        { error: "Private, loopback, or link-local hosts are blocked for security" },
        { status: 403 },
      );
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const fetched = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "CortexMD-Clipper/1.0" },
      });
      clearTimeout(timeout);
      if (!fetched.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL (HTTP ${fetched.status})` },
          { status: 502 },
        );
      }
      const htmlOrText = (await fetched.text()).slice(0, 250_000);
      inferredHtmlTitle = extractTitleFromHtml(htmlOrText);
      rawSource = htmlOrText;
    } catch (err) {
      return NextResponse.json(
        { error: `URL fetch error: ${err instanceof Error ? err.message : "Timeout"}` },
        { status: 502 },
      );
    }
  } else if (rawSource && /<html|<title|<h1/i.test(rawSource)) {
    inferredHtmlTitle = extractTitleFromHtml(rawSource);
  }

  if (!rawSource) {
    return NextResponse.json(
      { error: "Provide rawContent (text/HTML/Markdown) or fetchUrl with sourceUrl" },
      { status: 400 },
    );
  }

  const cleanBody = htmlToCleanMarkdown(rawSource);
  const title =
    (body.title || "").trim() ||
    inferredHtmlTitle ||
    (sourceUrl ? new URL(sourceUrl).hostname : "") ||
    "Clipped Source";

  const safeFileStem =
    title
      .replace(/[<>:"/\\|?*#[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72) || "Clipped Source";

  let relPath = normalizeRelPath(`Sources/${safeFileStem}.md`);
  if (!isPathPermittedForAi(ws.id, relPath)) {
    return NextResponse.json(
      { error: "Folder AI policy denies writing into Sources/" },
      { status: 403 },
    );
  }

  try {
    const candidateFull = resolveVaultPath(ws.root_path, relPath);
    if (fs.existsSync(candidateFull)) {
      const suffix = Date.now().toString(36).slice(-4);
      relPath = normalizeRelPath(`Sources/${safeFileStem}-${suffix}.md`);
      resolveVaultPath(ws.root_path, relPath);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid target path" },
      { status: 400 },
    );
  }

  const summaryBullets = extractSummaryBullets(cleanBody);
  const autoConcepts = extractConceptTags(`${title}\n${cleanBody}`).slice(0, 3);
  const finalTags = Array.from(
    new Set([
      "source",
      "clipped",
      ...(Array.isArray(body.tags) ? body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean) : []),
      ...autoConcepts,
    ]),
  );

  const nowIso = new Date().toISOString();
  const fullMarkdown = [
    "---",
    "type: source",
    `tags: [${finalTags.join(", ")}]`,
    ...(sourceUrl ? [`source_url: "${sourceUrl.replace(/"/g, "")}"`] : []),
    `clipped_at: ${nowIso}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Key Takeaways",
    ...summaryBullets.map((b) => `- ${b}`),
    "",
    "## Source Content",
    cleanBody.slice(0, 24_000),
    "",
  ].join("\n");

  writeMarkdownFile(ws.root_path, relPath, fullMarkdown);
  const noteId = indexSingleFile(ws.id, relPath, { force: true });
  resolveWorkspaceLinkTargets(ws.id);

  if (noteId) {
    broadcastEvent({
      type: "note:created",
      workspaceSlug: ws.slug,
      relPath,
      noteId,
    });
  }

  db.prepare(
    `INSERT INTO ai_audit_logs (id, workspace_id, conversation_id, provider_id, tool_name, target_path, action_status, details_json, created_at)
     VALUES (?, ?, NULL, 'local-hybrid', 'source_ingest', ?, 'completed', ?, ?)`,
  ).run(
    crypto.randomUUID(),
    ws.id,
    relPath,
    JSON.stringify({ sourceUrl: sourceUrl || null, tagCount: finalTags.length }),
    Date.now(),
  );

  const row = noteId
    ? (db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId) as unknown as {
        id: string;
        rel_path: string;
        title: string;
        folder: string;
        object_type: string;
        tags_json: string;
        word_count: number;
      })
    : null;

  return NextResponse.json(
    {
      note: row
        ? {
            id: row.id,
            relPath: row.rel_path,
            title: row.title,
            folder: row.folder,
            objectType: row.object_type,
            tags: JSON.parse(row.tags_json || "[]") as string[],
            wordCount: row.word_count,
          }
        : { id: noteId, relPath, title },
      summaryBullets,
    },
    { status: 201 },
  );
}
