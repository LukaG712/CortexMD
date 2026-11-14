import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getDb } from "./db";
import { broadcastEvent } from "./events";
import {
  computeSha256,
  ensureSeedWorkspaces,
  listMarkdownFilesOnDisk,
  normalizeRelPath,
  resolveVaultPath,
} from "./storage";
import {
  computeLocalEmbedding,
  cosineSimilarity,
  explainSharedConcepts,
} from "./ai/embeddings";

export interface ParsedHeading {
  level: number;
  text: string;
  slug: string;
  startLine: number;
  endLine: number;
}

export interface ParsedLink {
  targetRaw: string;
  targetNorm: string;
  alias: string | null;
  heading: string | null;
  lineNumber: number;
  contextSnippet: string;
}

export interface ParsedChunk {
  chunkIndex: number;
  heading: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ParsedTask {
  noteId: string;
  relPath: string;
  noteTitle: string;
  lineNumber: number;
  text: string;
  completed: boolean;
  status: "todo" | "doing" | "done";
  priority: "A" | "B" | "C" | null;
  tags: string[];
}

export interface ParsedMarkdown {
  title: string;
  objectType: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  body: string;
  wordCount: number;
  headings: ParsedHeading[];
  links: ParsedLink[];
  chunks: ParsedChunk[];
}

const watchers = new Map<string, fs.FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Normalize a [[WikiLink]] target for case-insensitive resolution across folders. */
export function normalizeLinkTarget(target: string): string {
  return target
    .replaceAll("\\", "/")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function getTitleFromRelPath(relPath: string): string {
  const base = path.posix.basename(relPath);
  return base.replace(/\.md$/i, "");
}

/** Parse Markdown frontmatter, headings, WikiLinks, inline tags, and heading-level RAG chunks. */
export function parseMarkdownDocument(relPath: string, rawContent: string): ParsedMarkdown {
  let frontmatter: Record<string, unknown> = {};
  let body = rawContent;
  try {
    const parsed = matter(rawContent);
    frontmatter = (parsed.data || {}) as Record<string, unknown>;
    body = parsed.content;
  } catch {
    frontmatter = {};
    body = rawContent;
  }

  const lines = rawContent.split(/\r?\n/);
  const headings: ParsedHeading[] = [];
  const links: ParsedLink[] = [];
  const tagSet = new Set<string>();

  // Frontmatter tags
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) {
      if (typeof t === "string" && t.trim()) {
        tagSet.add(t.trim().replace(/^#/, "").toLowerCase());
      }
    }
  } else if (typeof frontmatter.tags === "string") {
    for (const t of frontmatter.tags.split(/[,\s]+/)) {
      if (t.trim()) tagSet.add(t.trim().replace(/^#/, "").toLowerCase());
    }
  }

  let inFence = false;
  let inFrontmatter = lines[0]?.trim() === "---";
  let h1Title: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNum = idx + 1;

    if (idx > 0 && inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Headings
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (level === 1 && !h1Title) h1Title = text;
      headings.push({
        level,
        text,
        slug: slugifyHeading(text),
        startLine: lineNum,
        endLine: lines.length,
      });
    }

    // WikiLinks [[Target#Heading|Alias]]
    const wikiRegex = /\[\[([^\[\]\n]+?)\]\]/g;
    let wm: RegExpExecArray | null;
    while ((wm = wikiRegex.exec(line)) !== null) {
      const inner = wm[1].trim();
      if (!inner) continue;
      const [targetPart, aliasPart] = inner.split("|");
      const [targetPath, headingPart] = targetPart.split("#");
      const targetRaw = (targetPath || "").trim();
      if (!targetRaw) continue;
      links.push({
        targetRaw,
        targetNorm: normalizeLinkTarget(targetRaw),
        alias: aliasPart ? aliasPart.trim() : null,
        heading: headingPart ? headingPart.trim() : null,
        lineNumber: lineNum,
        contextSnippet: line.trim().slice(0, 220),
      });
    }

    // Inline #tags (avoiding URLs, hex colors, and markdown headings)
    const strippedLine = line.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "");
    const tagRegex = /(?:^|[\s(])#([a-zA-Z][a-zA-Z0-9_/-]{1,48})/g;
    let tm: RegExpExecArray | null;
    while ((tm = tagRegex.exec(strippedLine)) !== null) {
      tagSet.add(tm[1].toLowerCase());
    }
  }

  // Finalize heading end lines
  for (let i = 0; i < headings.length; i++) {
    if (i + 1 < headings.length) {
      headings[i].endLine = Math.max(headings[i].startLine, headings[i + 1].startLine - 1);
    }
  }

  // Build heading-aligned RAG chunks with exact line numbers
  const chunks: ParsedChunk[] = [];
  if (headings.length === 0) {
    const content = rawContent.trim();
    if (content) {
      chunks.push({
        chunkIndex: 0,
        heading: getTitleFromRelPath(relPath),
        startLine: 1,
        endLine: lines.length,
        content: content.slice(0, 2400),
      });
    }
  } else {
    if (headings[0].startLine > 1) {
      const intro = lines.slice(0, headings[0].startLine - 1).join("\n").trim();
      if (intro) {
        chunks.push({
          chunkIndex: 0,
          heading: "Overview",
          startLine: 1,
          endLine: headings[0].startLine - 1,
          content: intro.slice(0, 2400),
        });
      }
    }
    for (const h of headings) {
      const slice = lines.slice(h.startLine - 1, h.endLine).join("\n").trim();
      if (!slice) continue;
      chunks.push({
        chunkIndex: chunks.length,
        heading: h.text,
        startLine: h.startLine,
        endLine: h.endLine,
        content: slice.slice(0, 2400),
      });
    }
  }

  const title =
    (typeof frontmatter.title === "string" && frontmatter.title.trim()) ||
    h1Title ||
    getTitleFromRelPath(relPath);

  const objectType =
    typeof frontmatter.type === "string" && frontmatter.type.trim()
      ? frontmatter.type.trim().toLowerCase()
      : relPath.startsWith("journals/")
        ? "daily"
        : "note";

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  return {
    title,
    objectType,
    frontmatter,
    tags: Array.from(tagSet).sort(),
    body: rawContent,
    wordCount,
    headings,
    links,
    chunks,
  };
}

export interface ParsedFlashcard {
  front: string;
  back: string;
  lineNumber: number;
}

/** Extract flashcards (`Q:`/`A:`, `Front :: Back`, `#card`) from Markdown while skipping code/frontmatter. */
export function extractFlashcardsFromMarkdown(rawContent: string): ParsedFlashcard[] {
  const lines = rawContent.split(/\r?\n/);
  const cards: ParsedFlashcard[] = [];
  const seenFronts = new Set<string>();

  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;

  const pushCard = (frontRaw: string, backRaw: string, lineNumber: number) => {
    const front = frontRaw
      .replace(/^[-*]\s+/, "")
      .replace(/\s+#card\b/gi, "")
      .trim();
    const back = backRaw.replace(/\s+#card\b/gi, "").trim();
    if (!front || !back) return;
    const normKey = front.toLowerCase();
    if (seenFronts.has(normKey)) return;
    seenFronts.add(normKey);
    cards.push({ front: front.slice(0, 600), back: back.slice(0, 1500), lineNumber });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0 && inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // 1. Q: ... followed by A: ...
    const qMatch = /^(?:[-*]\s+)?(?:Q|Question):\s*(.+)$/i.exec(trimmed);
    if (qMatch && i + 1 < lines.length) {
      const nextTrim = lines[i + 1].trim();
      const aMatch = /^(?:[-*]\s+)?(?:A|Answer):\s*(.+)$/i.exec(nextTrim);
      if (aMatch) {
        pushCard(qMatch[1], aMatch[1], i + 1);
        i += 1;
        continue;
      }
    }

    // 2. Inline Front :: Back
    const dblIdx = trimmed.indexOf("::");
    if (dblIdx > 0) {
      const front = trimmed.slice(0, dblIdx).trim();
      const back = trimmed.slice(dblIdx + 2).trim();
      if (front && back && !/^https?:$/i.test(front)) {
        pushCard(front, back, i + 1);
        continue;
      }
    }

    // 3. Explicit #card heading or bullet with next non-empty line as answer
    if (/#card\b/i.test(trimmed) && i + 1 < lines.length) {
      const nextTrim = lines[i + 1].trim();
      if (nextTrim && !/^#+\s+/.test(nextTrim) && !/#card\b/i.test(nextTrim)) {
        const cleanFront = trimmed.replace(/^#+\s+/, "");
        const cleanBack = nextTrim.replace(/^[-*]\s+/, "");
        pushCard(cleanFront, cleanBack, i + 1);
        i += 1;
      }
    }
  }

  return cards;
}

/** Resolve [[WikiLink]] target_note_id references across all notes in a workspace. */
export function resolveWorkspaceLinkTargets(workspaceId: string): void {
  const db = getDb();
  const notes = db
    .prepare("SELECT id, rel_path, title FROM notes WHERE workspace_id = ? AND is_trashed = 0")
    .all(workspaceId) as Array<{ id: string; rel_path: string; title: string }>;

  const lookup = new Map<string, string>();
  for (const n of notes) {
    lookup.set(normalizeLinkTarget(n.rel_path), n.id);
    lookup.set(normalizeLinkTarget(getTitleFromRelPath(n.rel_path)), n.id);
    lookup.set(normalizeLinkTarget(n.title), n.id);
  }

  const links = db
    .prepare("SELECT id, target_norm FROM note_links WHERE workspace_id = ?")
    .all(workspaceId) as Array<{ id: string; target_norm: string }>;

  const updateStmt = db.prepare("UPDATE note_links SET target_note_id = ? WHERE id = ?");
  for (const link of links) {
    const resolved = lookup.get(link.target_norm) || null;
    updateStmt.run(resolved, link.id);
  }
}

/** Index or incrementally re-index a single Markdown file in a workspace. */
export function indexSingleFile(
  workspaceId: string,
  relPathInput: string,
  options?: { force?: boolean },
): string | null {
  const db = getDb();
  const ws = db
    .prepare("SELECT id, root_path FROM workspaces WHERE id = ?")
    .get(workspaceId) as { id: string; root_path: string } | undefined;
  if (!ws) return null;

  const relPath = normalizeRelPath(relPathInput);
  const fullPath = resolveVaultPath(ws.root_path, relPath);
  if (!fs.existsSync(fullPath)) {
    removeFileFromIndex(workspaceId, relPath);
    return null;
  }

  const stat = fs.statSync(fullPath);
  const rawContent = fs.readFileSync(fullPath, "utf8");
  const sha256 = computeSha256(rawContent);
  const mtimeMs = Math.round(stat.mtimeMs);

  const existing = db
    .prepare("SELECT id, sha256, is_favorite, is_pinned, is_trashed, created_at FROM notes WHERE workspace_id = ? AND rel_path = ?")
    .get(workspaceId, relPath) as
    | {
        id: string;
        sha256: string;
        is_favorite: number;
        is_pinned: number;
        is_trashed: number;
        created_at: number;
      }
    | undefined;

  if (existing && existing.sha256 === sha256 && !options?.force) {
    return existing.id;
  }

  const parsed = parseMarkdownDocument(relPath, rawContent);
  const folder = path.posix.dirname(relPath) === "." ? "" : path.posix.dirname(relPath);
  const now = Date.now();
  const noteId = existing?.id || crypto.randomUUID();
  const tagsJson = JSON.stringify(parsed.tags);
  const fmJson = JSON.stringify(parsed.frontmatter);

  db.exec("BEGIN");
  try {
    if (existing) {
      db.prepare(
        `UPDATE notes SET title = ?, folder = ?, object_type = ?, frontmatter_json = ?, tags_json = ?,
         body = ?, word_count = ?, sha256 = ?, mtime_ms = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        parsed.title,
        folder,
        parsed.objectType,
        fmJson,
        tagsJson,
        rawContent,
        parsed.wordCount,
        sha256,
        mtimeMs,
        now,
        noteId,
      );
      db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(noteId);
      db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(noteId);
      db.prepare("DELETE FROM note_links WHERE source_note_id = ?").run(noteId);
      db.prepare("DELETE FROM note_chunks WHERE note_id = ?").run(noteId);
    } else {
      db.prepare(
        `INSERT INTO notes (id, workspace_id, rel_path, title, folder, object_type, frontmatter_json, tags_json,
         body, word_count, sha256, is_favorite, is_pinned, is_trashed, mtime_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
      ).run(
        noteId,
        workspaceId,
        relPath,
        parsed.title,
        folder,
        parsed.objectType,
        fmJson,
        tagsJson,
        rawContent,
        parsed.wordCount,
        sha256,
        mtimeMs,
        now,
        now,
      );
    }

    db.prepare(
      "INSERT INTO notes_fts (note_id, workspace_id, rel_path, title, tags, body) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(noteId, workspaceId, relPath, parsed.title, parsed.tags.join(" "), rawContent);

    const insertHeading = db.prepare(
      "INSERT INTO note_headings (id, note_id, level, text, slug, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const h of parsed.headings) {
      insertHeading.run(crypto.randomUUID(), noteId, h.level, h.text, h.slug, h.startLine, h.endLine);
    }

    const insertLink = db.prepare(
      `INSERT INTO note_links (id, workspace_id, source_note_id, source_path, target_raw, target_norm,
       target_note_id, alias, heading, line_number, context_snippet)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    );
    for (const l of parsed.links) {
      insertLink.run(
        crypto.randomUUID(),
        workspaceId,
        noteId,
        relPath,
        l.targetRaw,
        l.targetNorm,
        l.alias,
        l.heading,
        l.lineNumber,
        l.contextSnippet,
      );
    }

    const insertChunk = db.prepare(
      `INSERT INTO note_chunks (id, note_id, workspace_id, chunk_index, heading, start_line, end_line, content, embedding_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of parsed.chunks) {
      const vec = computeLocalEmbedding(`${parsed.title}\n${c.heading}\n${c.content}`);
      insertChunk.run(
        crypto.randomUUID(),
        noteId,
        workspaceId,
        c.chunkIndex,
        c.heading,
        c.startLine,
        c.endLine,
        c.content,
        JSON.stringify(vec),
      );
    }

    // Reconcile spaced-repetition flashcards while preserving SM-2 review progress
    const parsedCards = extractFlashcardsFromMarkdown(rawContent);
    const keepCardIds: string[] = [];
    const upsertCard = db.prepare(
      `INSERT INTO flashcards (id, workspace_id, note_id, rel_path, front, back, line_number, due_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rel_path = excluded.rel_path,
         back = excluded.back,
         line_number = excluded.line_number,
         updated_at = excluded.updated_at`,
    );
    for (const fc of parsedCards) {
      const cardId = crypto
        .createHash("sha256")
        .update(`${workspaceId}::${noteId}::${fc.front.toLowerCase()}`)
        .digest("hex")
        .slice(0, 32);
      keepCardIds.push(cardId);
      upsertCard.run(cardId, workspaceId, noteId, relPath, fc.front, fc.back, fc.lineNumber, now, now);
    }
    if (keepCardIds.length === 0) {
      db.prepare("DELETE FROM flashcards WHERE note_id = ?").run(noteId);
    } else {
      const placeholders = keepCardIds.map(() => "?").join(", ");
      db.prepare(
        `DELETE FROM flashcards WHERE note_id = ? AND id NOT IN (${placeholders})`,
      ).run(noteId, ...keepCardIds);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  resolveWorkspaceLinkTargets(workspaceId);
  return noteId;
}

/** Remove a deleted Markdown file from all index tables. */
export function removeFileFromIndex(workspaceId: string, relPathInput: string): void {
  const db = getDb();
  const relPath = normalizeRelPath(relPathInput);
  const existing = db
    .prepare("SELECT id FROM notes WHERE workspace_id = ? AND rel_path = ?")
    .get(workspaceId, relPath) as { id: string } | undefined;
  if (!existing) return;

  db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(existing.id);
  db.prepare("DELETE FROM notes WHERE id = ?").run(existing.id);
  resolveWorkspaceLinkTargets(workspaceId);
}

/** Reconcile disk Markdown files with SQLite index incrementally (skipping unchanged SHA-256 files). */
export function reconcileWorkspace(workspaceId: string): {
  indexed: number;
  removed: number;
  total: number;
} {
  const db = getDb();
  const ws = db
    .prepare("SELECT id, root_path, slug FROM workspaces WHERE id = ?")
    .get(workspaceId) as { id: string; root_path: string; slug: string } | undefined;
  if (!ws) return { indexed: 0, removed: 0, total: 0 };

  fs.mkdirSync(ws.root_path, { recursive: true });
  const diskFiles = listMarkdownFilesOnDisk(ws.root_path);
  const diskSet = new Set(diskFiles);

  const dbRows = db
    .prepare("SELECT id, rel_path, sha256, mtime_ms FROM notes WHERE workspace_id = ? AND is_trashed = 0")
    .all(workspaceId) as Array<{
    id: string;
    rel_path: string;
    sha256: string;
    mtime_ms: number;
  }>;

  let removed = 0;
  for (const row of dbRows) {
    if (!diskSet.has(row.rel_path)) {
      removeFileFromIndex(workspaceId, row.rel_path);
      removed++;
    }
  }

  let indexed = 0;
  const dbMap = new Map(dbRows.map((r) => [r.rel_path, r]));
  for (const relPath of diskFiles) {
    const existing = dbMap.get(relPath);
    const fullPath = resolveVaultPath(ws.root_path, relPath);
    const stat = fs.statSync(fullPath);
    const mtimeMs = Math.round(stat.mtimeMs);
    if (!existing || existing.mtime_ms !== mtimeMs) {
      indexSingleFile(workspaceId, relPath);
      indexed++;
    }
  }

  resolveWorkspaceLinkTargets(workspaceId);
  startWorkspaceWatcher(ws.id, ws.root_path, ws.slug);
  return { indexed, removed, total: diskFiles.length };
}

/** Ensure seed workspaces exist and every workspace is reconciled & watched. */
export function ensureAllWorkspacesIndexed(): void {
  ensureSeedWorkspaces();
  const db = getDb();
  const rows = db.prepare("SELECT id FROM workspaces").all() as Array<{ id: string }>;
  for (const row of rows) {
    reconcileWorkspace(row.id);
  }
}

/** Attach a debounced filesystem watcher to detect out-of-band .md edits on disk. */
export function startWorkspaceWatcher(
  workspaceId: string,
  rootPath: string,
  slug: string,
): void {
  if (watchers.has(workspaceId) || process.env.NODE_ENV === "test") return;
  try {
    const watcher = fs.watch(
      rootPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const rel = filename.replaceAll("\\", "/");
        if (!rel.toLowerCase().endsWith(".md") || rel.startsWith(".")) return;

        const key = `${workspaceId}:${rel}`;
        const prev = debounceTimers.get(key);
        if (prev) clearTimeout(prev);
        debounceTimers.set(
          key,
          setTimeout(() => {
            debounceTimers.delete(key);
            try {
              const full = resolveVaultPath(rootPath, rel);
              if (fs.existsSync(full)) {
                const noteId = indexSingleFile(workspaceId, rel);
                if (noteId) {
                  broadcastEvent({
                    type: "note:updated",
                    workspaceSlug: slug,
                    relPath: rel,
                    noteId,
                  });
                }
              } else {
                removeFileFromIndex(workspaceId, rel);
                broadcastEvent({
                  type: "note:deleted",
                  workspaceSlug: slug,
                  relPath: rel,
                });
              }
            } catch {
              // ignore transient FS watcher race errors
            }
          }, 250),
        );
      },
    );
    watchers.set(workspaceId, watcher);
  } catch {
    // Fallback if OS/container lacks recursive fs.watch support; periodic reconciliation covers it
  }
}

/** Find unlinked plain-text mentions of a note's title inside other workspace notes. */
export function findUnlinkedMentions(
  workspaceId: string,
  noteId: string,
): Array<{
  sourceNoteId: string;
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number;
  snippet: string;
  matchedTerm: string;
}> {
  const db = getDb();
  const target = db
    .prepare("SELECT id, rel_path, title FROM notes WHERE id = ? AND workspace_id = ?")
    .get(noteId, workspaceId) as { id: string; rel_path: string; title: string } | undefined;
  if (!target) return [];

  const fileStem = getTitleFromRelPath(target.rel_path);
  const terms = Array.from(new Set([target.title.trim(), fileStem.trim()])).filter(
    (t) => t.length >= 3,
  );
  if (terms.length === 0) return [];

  const others = db
    .prepare("SELECT id, rel_path, title, body FROM notes WHERE workspace_id = ? AND id != ? AND is_trashed = 0")
    .all(workspaceId, noteId) as Array<{
    id: string;
    rel_path: string;
    title: string;
    body: string;
  }>;

  const mentions: Array<{
    sourceNoteId: string;
    sourcePath: string;
    sourceTitle: string;
    lineNumber: number;
    snippet: string;
    matchedTerm: string;
  }> = [];

  for (const other of others) {
    const lines = other.body.split(/\r?\n/);
    let inFm = lines[0]?.trim() === "---";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i > 0 && inFm) {
        if (line.trim() === "---") inFm = false;
        continue;
      }
      if (/^#{1,6}\s/.test(line)) continue;
      // Strip existing [[WikiLinks]] before scanning
      const withoutLinks = line.replace(/\[\[[^\]]+\]\]/g, "");
      for (const term of terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rx = new RegExp(`\\b${escaped}\\b`, "i");
        const m = rx.exec(withoutLinks);
        if (m) {
          mentions.push({
            sourceNoteId: other.id,
            sourcePath: other.rel_path,
            sourceTitle: other.title,
            lineNumber: i + 1,
            snippet: line.trim().slice(0, 220),
            matchedTerm: m[0],
          });
          break;
        }
      }
    }
  }

  return mentions;
}

/** Find semantically related notes using chunk vector similarity + shared tags. */
export function findRelatedNotes(
  workspaceId: string,
  noteId: string,
  limit = 6,
): Array<{
  noteId: string;
  relPath: string;
  title: string;
  objectType: string;
  score: number;
  sharedTags: string[];
  sharedConcepts: string[];
}> {
  const db = getDb();
  const targetNote = db
    .prepare("SELECT id, tags_json, body, title FROM notes WHERE id = ? AND workspace_id = ?")
    .get(noteId, workspaceId) as
    | { id: string; tags_json: string; body: string; title: string }
    | undefined;
  if (!targetNote) return [];

  const targetText = `${targetNote.title}\n${targetNote.body.slice(0, 3000)}`;
  const targetVec = computeLocalEmbedding(targetText);
  const targetTags = new Set<string>(JSON.parse(targetNote.tags_json || "[]"));

  const candidateChunks = db
    .prepare(
      `SELECT n.id as note_id, n.rel_path, n.title, n.object_type, n.tags_json, n.body as note_body, c.embedding_json
       FROM note_chunks c
       JOIN notes n ON n.id = c.note_id
       WHERE c.workspace_id = ? AND n.id != ? AND n.is_trashed = 0`,
    )
    .all(workspaceId, noteId) as Array<{
    note_id: string;
    rel_path: string;
    title: string;
    object_type: string;
    tags_json: string;
    note_body: string;
    embedding_json: string;
  }>;

  const bestByNote = new Map<
    string,
    {
      noteId: string;
      relPath: string;
      title: string;
      objectType: string;
      score: number;
      sharedTags: string[];
      sharedConcepts: string[];
    }
  >();

  for (const row of candidateChunks) {
    const vec = JSON.parse(row.embedding_json) as number[];
    const sim = cosineSimilarity(targetVec, vec);
    const otherTags = JSON.parse(row.tags_json || "[]") as string[];
    const shared = otherTags.filter((t) => targetTags.has(t));
    const combined = sim + shared.length * 0.08;
    const prev = bestByNote.get(row.note_id);
    if (!prev || combined > prev.score) {
      bestByNote.set(row.note_id, {
        noteId: row.note_id,
        relPath: row.rel_path,
        title: row.title,
        objectType: row.object_type,
        score: Number(combined.toFixed(3)),
        sharedTags: shared,
        sharedConcepts: explainSharedConcepts(
          targetText,
          `${row.title}\n${row.note_body.slice(0, 1500)}`,
        ),
      });
    }
  }

  return Array.from(bestByNote.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Find shortest undirected link path between two notes inside a workspace using BFS. */
export function findShortestNotePath(
  workspaceId: string,
  fromNoteId: string,
  toNoteId: string,
): string[] {
  if (!fromNoteId || !toNoteId) return [];
  if (fromNoteId === toNoteId) return [fromNoteId];

  const db = getDb();
  const links = db
    .prepare(
      "SELECT source_note_id, target_note_id FROM note_links WHERE workspace_id = ? AND target_note_id IS NOT NULL",
    )
    .all(workspaceId) as Array<{ source_note_id: string; target_note_id: string }>;

  const adj = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.source_note_id === l.target_note_id) continue;
    if (!adj.has(l.source_note_id)) adj.set(l.source_note_id, new Set());
    if (!adj.has(l.target_note_id)) adj.set(l.target_note_id, new Set());
    adj.get(l.source_note_id)!.add(l.target_note_id);
    adj.get(l.target_note_id)!.add(l.source_note_id);
  }

  const visited = new Set<string>([fromNoteId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromNoteId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const next of adj.get(curr) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, curr);
      if (next === toNoteId) {
        const pathOut: string[] = [toNoteId];
        let step: string | undefined = curr;
        while (step) {
          pathOut.unshift(step);
          step = parent.get(step);
        }
        return pathOut;
      }
      queue.push(next);
    }
  }

  return [];
}

/** Build the interactive node/edge graph for a workspace, including semantic ghost edges, topic clusters, and optional shortest path. */
export function buildWorkspaceGraph(
  workspaceId: string,
  options?: { pathFrom?: string; pathTo?: string },
): {
  nodes: Array<{
    id: string;
    relPath: string;
    title: string;
    folder: string;
    objectType: string;
    tags: string[];
    degree: number;
    isOrphan: boolean;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
  }>;
  semanticEdges: Array<{
    source: string;
    target: string;
    score: number;
    sharedConcepts: string[];
  }>;
  clusters: Array<{
    id: string;
    label: string;
    color: string;
    nodeIds: string[];
  }>;
  shortestPath?: string[];
} {
  const db = getDb();
  const notes = db
    .prepare(
      "SELECT id, rel_path, title, folder, object_type, tags_json, body FROM notes WHERE workspace_id = ? AND is_trashed = 0",
    )
    .all(workspaceId) as Array<{
    id: string;
    rel_path: string;
    title: string;
    folder: string;
    object_type: string;
    tags_json: string;
    body: string;
  }>;

  const links = db
    .prepare(
      "SELECT source_note_id, target_note_id, target_raw FROM note_links WHERE workspace_id = ? AND target_note_id IS NOT NULL",
    )
    .all(workspaceId) as Array<{
    source_note_id: string;
    target_note_id: string;
    target_raw: string;
  }>;

  const degreeMap = new Map<string, number>();
  const edgeKeys = new Set<string>();
  const undirectedEdgeSet = new Set<string>();
  const edges: Array<{ source: string; target: string; label: string }> = [];

  for (const l of links) {
    if (l.source_note_id === l.target_note_id) continue;
    const key = `${l.source_note_id}->${l.target_note_id}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source: l.source_note_id, target: l.target_note_id, label: l.target_raw });
      degreeMap.set(l.source_note_id, (degreeMap.get(l.source_note_id) || 0) + 1);
      degreeMap.set(l.target_note_id, (degreeMap.get(l.target_note_id) || 0) + 1);
    }
    undirectedEdgeSet.add([l.source_note_id, l.target_note_id].sort().join("::"));
  }

  const nodes = notes.map((n) => {
    const degree = degreeMap.get(n.id) || 0;
    return {
      id: n.id,
      relPath: n.rel_path,
      title: n.title,
      folder: n.folder || "(root)",
      objectType: n.object_type,
      tags: JSON.parse(n.tags_json || "[]") as string[],
      degree,
      isOrphan: degree === 0,
    };
  });

  // Semantic Ghost Edges across unlinked notes
  const chunkRows = db
    .prepare(
      `SELECT note_id, embedding_json
       FROM note_chunks
       WHERE workspace_id = ? AND chunk_index = 0`,
    )
    .all(workspaceId) as Array<{ note_id: string; embedding_json: string }>;

  const vecByNote = new Map<string, number[]>();
  for (const cr of chunkRows) {
    try {
      vecByNote.set(cr.note_id, JSON.parse(cr.embedding_json) as number[]);
    } catch {
      // skip invalid vector
    }
  }

  const textByNote = new Map<string, string>();
  for (const n of notes) {
    const text = `${n.title}\n${n.body.slice(0, 1600)}`;
    textByNote.set(n.id, text);
    if (!vecByNote.has(n.id)) {
      vecByNote.set(n.id, computeLocalEmbedding(text));
    }
  }

  const semanticEdges: Array<{
    source: string;
    target: string;
    score: number;
    sharedConcepts: string[];
  }> = [];

  for (let i = 0; i < nodes.length && i < 80; i++) {
    for (let j = i + 1; j < nodes.length && j < 80; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const pairKey = [a.id, b.id].sort().join("::");
      if (undirectedEdgeSet.has(pairKey)) continue;

      const vecA = vecByNote.get(a.id);
      const vecB = vecByNote.get(b.id);
      if (!vecA || !vecB) continue;

      const sim = cosineSimilarity(vecA, vecB);
      if (sim < 0.3) continue;

      const sharedConcepts = explainSharedConcepts(
        textByNote.get(a.id) || a.title,
        textByNote.get(b.id) || b.title,
      );
      if (sim >= 0.34 || sharedConcepts.length > 0) {
        semanticEdges.push({
          source: a.id,
          target: b.id,
          score: Number(sim.toFixed(3)),
          sharedConcepts: sharedConcepts.slice(0, 3),
        });
      }
    }
  }
  semanticEdges.sort((x, y) => y.score - x.score);
  const topSemanticEdges = semanticEdges.slice(0, 25);

  // Connected-component Topic Clusters
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) || []), e.source]);
  }
  const visited = new Set<string>();
  const clusterColors = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899"];
  const clusters: Array<{ id: string; label: string; color: string; nodeIds: string[] }> = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const comp: string[] = [];
    const stack = [n.id];
    visited.add(n.id);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      comp.push(curr);
      for (const nxt of adj.get(curr) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      }
    }
    if (comp.length >= 2) {
      const tagFreq = new Map<string, number>();
      let topHub = nodeMap.get(comp[0])!;
      for (const cid of comp) {
        const cn = nodeMap.get(cid);
        if (!cn) continue;
        if (cn.degree > topHub.degree) topHub = cn;
        for (const t of cn.tags) {
          tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
        }
      }
      const bestTag = Array.from(tagFreq.entries()).sort((x, y) => y[1] - x[1])[0]?.[0];
      const idx = clusters.length;
      clusters.push({
        id: `cluster-${idx + 1}`,
        label: bestTag ? `#${bestTag}` : topHub.title,
        color: clusterColors[idx % clusterColors.length],
        nodeIds: comp,
      });
    }
  }

  const shortestPath =
    options?.pathFrom && options?.pathTo
      ? findShortestNotePath(workspaceId, options.pathFrom, options.pathTo)
      : undefined;

  return { nodes, edges, semanticEdges: topSemanticEdges, clusters, shortestPath };
}

/** Extract markdown checklist & Logseq-style tasks across all notes in a workspace. */
export function extractWorkspaceTasks(workspaceId: string): ParsedTask[] {
  const db = getDb();
  const notes = db
    .prepare("SELECT id, rel_path, title, body, tags_json FROM notes WHERE workspace_id = ? AND is_trashed = 0")
    .all(workspaceId) as Array<{
    id: string;
    rel_path: string;
    title: string;
    body: string;
    tags_json: string;
  }>;

  const tasks: ParsedTask[] = [];
  for (const n of notes) {
    const lines = n.body.split(/\r?\n/);
    const noteTags = JSON.parse(n.tags_json || "[]") as string[];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cbMatch = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
      const logseqMatch = !cbMatch
        ? /^\s*[-*]?\s*(TODO|DOING|NOW|LATER|DONE)\s+(.+)$/.exec(line)
        : null;
      if (!cbMatch && !logseqMatch) continue;

      let completed = false;
      let status: "todo" | "doing" | "done" = "todo";
      let rawText = "";

      if (cbMatch) {
        completed = cbMatch[1].toLowerCase() === "x";
        status = completed ? "done" : /#doing|\bDOING\b/i.test(cbMatch[2]) ? "doing" : "todo";
        rawText = cbMatch[2].trim();
      } else if (logseqMatch) {
        const kw = logseqMatch[1].toUpperCase();
        completed = kw === "DONE";
        status = kw === "DONE" ? "done" : kw === "DOING" || kw === "NOW" ? "doing" : "todo";
        rawText = logseqMatch[2].trim();
      }

      const prioMatch = /\[#(A|B|C)\]/i.exec(rawText);
      const priority = prioMatch ? (prioMatch[1].toUpperCase() as "A" | "B" | "C") : null;

      tasks.push({
        noteId: n.id,
        relPath: n.rel_path,
        noteTitle: n.title,
        lineNumber: i + 1,
        text: rawText,
        completed,
        status,
        priority,
        tags: noteTags,
      });
    }
  }

  return tasks;
}
