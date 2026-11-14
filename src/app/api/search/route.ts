import { NextRequest, NextResponse } from "next/server";
import { computeLocalEmbedding, cosineSimilarity } from "@/lib/ai/embeddings";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";

export const dynamic = "force-dynamic";

function buildSafeFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  ensureAllWorkspacesIndexed();
  const db = getDb();

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const workspaceSlug = (req.nextUrl.searchParams.get("workspaceSlug") || "").trim();
  const mode = (req.nextUrl.searchParams.get("mode") || "hybrid") as
    | "hybrid"
    | "fts"
    | "semantic";
  const tag = (req.nextUrl.searchParams.get("tag") || "").trim();
  const objectType = (req.nextUrl.searchParams.get("objectType") || "").trim();
  const folder = (req.nextUrl.searchParams.get("folder") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 24));

  const targetWs =
    workspaceSlug && workspaceSlug !== "all"
      ? (db.prepare("SELECT id, slug FROM workspaces WHERE slug = ?").get(workspaceSlug) as
          | { id: string; slug: string }
          | undefined)
      : undefined;

  if (workspaceSlug && workspaceSlug !== "all" && !targetWs) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Filter-only path when search query is empty
  if (!q) {
    let sql = `
      SELECT n.id, n.workspace_id, w.slug as workspace_slug, n.rel_path, n.title, n.folder,
             n.object_type, n.tags_json, n.word_count, n.updated_at, substr(n.body, 1, 240) as preview
      FROM notes n
      JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.is_trashed = 0
    `;
    const params: string[] = [];
    if (targetWs) {
      sql += " AND n.workspace_id = ?";
      params.push(targetWs.id);
    }
    if (objectType) {
      sql += " AND n.object_type = ?";
      params.push(objectType);
    }
    if (folder) {
      sql += " AND (n.folder = ? OR n.folder LIKE ?)";
      params.push(folder, `${folder}/%`);
    }
    sql += " ORDER BY n.updated_at DESC LIMIT ?";
    const rows = db.prepare(sql).all(...params, limit * 2) as Array<{
      id: string;
      workspace_id: string;
      workspace_slug: string;
      rel_path: string;
      title: string;
      folder: string;
      object_type: string;
      tags_json: string;
      word_count: number;
      updated_at: number;
      preview: string;
    }>;

    const filtered = rows
      .filter((r) => {
        if (!tag) return true;
        const tags = JSON.parse(r.tags_json || "[]") as string[];
        return tags.includes(tag);
      })
      .slice(0, limit)
      .map((r) => ({
        noteId: r.id,
        workspaceSlug: r.workspace_slug,
        relPath: r.rel_path,
        title: r.title,
        folder: r.folder,
        objectType: r.object_type,
        tags: JSON.parse(r.tags_json || "[]") as string[],
        snippet: r.preview,
        matchType: "filter",
        score: 1,
        updatedAt: r.updated_at,
      }));

    return NextResponse.json({ results: filtered });
  }

  interface MergedHit {
    noteId: string;
    workspaceSlug: string;
    relPath: string;
    title: string;
    folder: string;
    objectType: string;
    tags: string[];
    snippet: string;
    heading?: string;
    startLine?: number;
    endLine?: number;
    ftsScore: number;
    semanticScore: number;
    updatedAt: number;
  }

  const merged = new Map<string, MergedHit>();

  const matchesMetaFilters = (row: {
    object_type: string;
    folder: string;
    tags_json: string;
  }) => {
    if (objectType && row.object_type !== objectType) return false;
    if (folder && row.folder !== folder && !row.folder.startsWith(`${folder}/`)) return false;
    if (tag) {
      const parsed = JSON.parse(row.tags_json || "[]") as string[];
      if (!parsed.includes(tag)) return false;
    }
    return true;
  };

  if (mode === "hybrid" || mode === "fts") {
    const ftsQuery = buildSafeFtsQuery(q);
    if (ftsQuery) {
      try {
        let ftsSql = `
          SELECT n.id, w.slug as workspace_slug, n.rel_path, n.title, n.folder, n.object_type,
                 n.tags_json, n.updated_at, bm25(notes_fts) as rank,
                 snippet(notes_fts, 5, '<mark>', '</mark>', '...', 22) as snippet
          FROM notes_fts
          JOIN notes n ON n.id = notes_fts.note_id
          JOIN workspaces w ON w.id = n.workspace_id
          WHERE notes_fts MATCH ? AND n.is_trashed = 0
        `;
        const params: string[] = [ftsQuery];
        if (targetWs) {
          ftsSql += " AND n.workspace_id = ?";
          params.push(targetWs.id);
        }
        ftsSql += " ORDER BY rank LIMIT 40";

        const ftsRows = db.prepare(ftsSql).all(...params) as Array<{
          id: string;
          workspace_slug: string;
          rel_path: string;
          title: string;
          folder: string;
          object_type: string;
          tags_json: string;
          updated_at: number;
          rank: number;
          snippet: string;
        }>;

        ftsRows.forEach((r, idx) => {
          if (!matchesMetaFilters(r)) return;
          merged.set(r.id, {
            noteId: r.id,
            workspaceSlug: r.workspace_slug,
            relPath: r.rel_path,
            title: r.title,
            folder: r.folder,
            objectType: r.object_type,
            tags: JSON.parse(r.tags_json || "[]") as string[],
            snippet: r.snippet,
            ftsScore: 1 / (idx + 1.5),
            semanticScore: 0,
            updatedAt: r.updated_at,
          });
        });
      } catch {
        // Fallback to semantic/substring match below
      }
    }
  }

  if (mode === "hybrid" || mode === "semantic") {
    const qVec = computeLocalEmbedding(q);
    let semSql = `
      SELECT c.note_id, w.slug as workspace_slug, n.rel_path, n.title, n.folder, n.object_type,
             n.tags_json, n.updated_at, c.heading, c.start_line, c.end_line, c.content, c.embedding_json
      FROM note_chunks c
      JOIN notes n ON n.id = c.note_id
      JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.is_trashed = 0
    `;
    const params: string[] = [];
    if (targetWs) {
      semSql += " AND n.workspace_id = ?";
      params.push(targetWs.id);
    }

    const chunkRows = db.prepare(semSql).all(...params) as Array<{
      note_id: string;
      workspace_slug: string;
      rel_path: string;
      title: string;
      folder: string;
      object_type: string;
      tags_json: string;
      updated_at: number;
      heading: string;
      start_line: number;
      end_line: number;
      content: string;
      embedding_json: string;
    }>;

    const qLower = q.toLowerCase();
    for (const row of chunkRows) {
      if (!matchesMetaFilters(row)) continue;
      const vec = JSON.parse(row.embedding_json) as number[];
      let sem = cosineSimilarity(qVec, vec);
      if (
        row.title.toLowerCase().includes(qLower) ||
        row.content.toLowerCase().includes(qLower)
      ) {
        sem += 0.25;
      }
      if (sem < 0.08 && !merged.has(row.note_id)) continue;

      const existing = merged.get(row.note_id);
      if (!existing) {
        merged.set(row.note_id, {
          noteId: row.note_id,
          workspaceSlug: row.workspace_slug,
          relPath: row.rel_path,
          title: row.title,
          folder: row.folder,
          objectType: row.object_type,
          tags: JSON.parse(row.tags_json || "[]") as string[],
          snippet: row.content.slice(0, 260),
          heading: row.heading,
          startLine: row.start_line,
          endLine: row.end_line,
          ftsScore: 0,
          semanticScore: sem,
          updatedAt: row.updated_at,
        });
      } else if (sem > existing.semanticScore) {
        existing.semanticScore = sem;
        existing.heading = row.heading;
        existing.startLine = row.start_line;
        existing.endLine = row.end_line;
      }
    }
  }

  const results = Array.from(merged.values())
    .map((h) => ({
      ...h,
      matchType:
        h.ftsScore > 0 && h.semanticScore > 0.1
          ? "hybrid"
          : h.ftsScore > 0
            ? "fts"
            : "semantic",
      score: Number((h.ftsScore * 0.7 + h.semanticScore * 0.8).toFixed(4)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return NextResponse.json({ results });
}
