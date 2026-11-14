import { getDb } from "@/lib/db";
import { isPathPermittedForAi } from "./acl";
import { computeLocalEmbedding, cosineSimilarity } from "./embeddings";

export interface RagCitation {
  noteId: string;
  workspaceId: string;
  workspaceSlug: string;
  relPath: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

export interface RetrievalScope {
  mode: "workspace" | "all" | "folder" | "note";
  workspaceId: string;
  folderPrefix?: string;
  noteId?: string;
  limit?: number;
}

export interface ContradictionFinding {
  kind: "numeric-mismatch" | "duplicate-overlap";
  summary: string;
  citations: RagCitation[];
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /disregard\s+(all\s+)?system\s+prompts?/gi,
  /you\s+are\s+now\s+(in\s+)?developer\s+mode/gi,
  /execute\s+shell\s+command/gi,
  /exfiltrate\s+/gi,
];

/** Neutralize suspected prompt-injection directives inside untrusted Markdown note content. */
export function sanitizeUntrustedNoteText(raw: string): string {
  let clean = raw;
  for (const rx of INJECTION_PATTERNS) {
    clean = clean.replace(rx, "[FILTERED_DIRECTIVE]");
  }
  return clean.replace(/<\/?untrusted_note_data[^>]*>/gi, "");
}

/** Build the untrusted-data context block passed to external LLMs/CLIs. */
export function buildUntrustedContextBlock(citations: RagCitation[]): string {
  if (citations.length === 0) {
    return "<knowledge_base_context>No permitted matching notes found.</knowledge_base_context>";
  }
  const sections = citations.map((c, idx) => {
    const safe = sanitizeUntrustedNoteText(c.snippet);
    return [
      `<untrusted_note_data index="${idx + 1}" workspace="${c.workspaceSlug}" path="${c.relPath}" heading="${c.heading}" lines="L${c.startLine}-L${c.endLine}">`,
      safe,
      `</untrusted_note_data>`,
    ].join("\n");
  });
  return sections.join("\n\n");
}

function buildSafeFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 10);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Retrieve top-k grounded Markdown chunks using hybrid FTS5 BM25 + 384-dim semantic similarity,
 * strictly enforcing folder ACLs before chunks ever leave the database.
 */
export function retrieveGroundedChunks(
  query: string,
  scope: RetrievalScope,
): RagCitation[] {
  const db = getDb();
  const limit = scope.limit || 8;
  const queryVec = computeLocalEmbedding(query);

  // 1. Fetch candidate chunks filtered by scope
  let sql = `
    SELECT c.id as chunk_id, c.note_id, c.workspace_id, w.slug as workspace_slug,
           n.rel_path, n.title, c.heading, c.start_line, c.end_line, c.content, c.embedding_json
    FROM note_chunks c
    JOIN notes n ON n.id = c.note_id
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE n.is_trashed = 0 AND w.ai_enabled = 1
  `;
  const params: Array<string> = [];

  if (scope.mode !== "all") {
    sql += " AND c.workspace_id = ?";
    params.push(scope.workspaceId);
  }
  if (scope.mode === "note" && scope.noteId) {
    sql += " AND c.note_id = ?";
    params.push(scope.noteId);
  }
  if (scope.mode === "folder" && scope.folderPrefix) {
    const cleanFolder = scope.folderPrefix.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (cleanFolder) {
      sql += " AND (n.folder = ? OR n.folder LIKE ?)";
      params.push(cleanFolder, `${cleanFolder}/%`);
    }
  }

  const candidateRows = db.prepare(sql).all(...params) as Array<{
    chunk_id: string;
    note_id: string;
    workspace_id: string;
    workspace_slug: string;
    rel_path: string;
    title: string;
    heading: string;
    start_line: number;
    end_line: number;
    content: string;
    embedding_json: string;
  }>;

  // Enforce AI Folder ACL BEFORE scoring/returning any document content
  const permitted = candidateRows.filter((row) =>
    isPathPermittedForAi(row.workspace_id, row.rel_path),
  );
  if (permitted.length === 0) return [];

  // 2. Keyword FTS5 scores per note_id
  const ftsBoostByNote = new Map<string, number>();
  const ftsQuery = buildSafeFtsQuery(query);
  if (ftsQuery) {
    try {
      let ftsSql = `SELECT note_id, bm25(notes_fts) as rank FROM notes_fts WHERE notes_fts MATCH ?`;
      const ftsParams: Array<string> = [ftsQuery];
      if (scope.mode !== "all") {
        ftsSql += " AND workspace_id = ?";
        ftsParams.push(scope.workspaceId);
      }
      ftsSql += " ORDER BY rank LIMIT 30";
      const ftsRows = db.prepare(ftsSql).all(...ftsParams) as Array<{
        note_id: string;
        rank: number;
      }>;
      ftsRows.forEach((r, idx) => {
        ftsBoostByNote.set(r.note_id, 1 / (idx + 2));
      });
    } catch {
      // Ignore malformed FTS syntax fallback
    }
  }

  // 3. Hybrid Reciprocal Rank Fusion + Exact Term Overlap
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const scored = permitted.map((row) => {
    const vec = JSON.parse(row.embedding_json) as number[];
    const semScore = cosineSimilarity(queryVec, vec);
    const ftsBonus = ftsBoostByNote.get(row.note_id) || 0;
    const lowerText = `${row.title} ${row.heading} ${row.content}`.toLowerCase();
    let termHits = 0;
    for (const t of queryTerms) {
      if (lowerText.includes(t)) termHits++;
    }
    const lexicalRatio = queryTerms.length > 0 ? termHits / queryTerms.length : 0;
    const totalScore = semScore * 0.55 + ftsBonus * 0.65 + lexicalRatio * 0.45;

    return {
      noteId: row.note_id,
      workspaceId: row.workspace_id,
      workspaceSlug: row.workspace_slug,
      relPath: row.rel_path,
      title: row.title,
      heading: row.heading || row.title,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.content.slice(0, 700),
      score: Number(totalScore.toFixed(4)),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Scan permitted notes for semantic duplicates and potential numeric/spec contradictions.
 */
export function analyzeContradictionsAndDuplicates(
  workspaceId: string,
  allWorkspaces = false,
): ContradictionFinding[] {
  const db = getDb();
  let sql = `
    SELECT c.note_id, c.workspace_id, w.slug as workspace_slug, n.rel_path, n.title,
           c.heading, c.start_line, c.end_line, c.content, c.embedding_json
    FROM note_chunks c
    JOIN notes n ON n.id = c.note_id
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE n.is_trashed = 0 AND w.ai_enabled = 1
  `;
  const rows = (
    allWorkspaces
      ? db.prepare(sql).all()
      : db.prepare(`${sql} AND c.workspace_id = ?`).all(workspaceId)
  ) as Array<{
    note_id: string;
    workspace_id: string;
    workspace_slug: string;
    rel_path: string;
    title: string;
    heading: string;
    start_line: number;
    end_line: number;
    content: string;
    embedding_json: string;
  }>;

  const permitted = rows.filter((r) => isPathPermittedForAi(r.workspace_id, r.rel_path));
  const findings: ContradictionFinding[] = [];
  const seenPairs = new Set<string>();

  const toCitation = (r: (typeof permitted)[number], score: number): RagCitation => ({
    noteId: r.note_id,
    workspaceId: r.workspace_id,
    workspaceSlug: r.workspace_slug,
    relPath: r.rel_path,
    title: r.title,
    heading: r.heading,
    startLine: r.start_line,
    endLine: r.end_line,
    snippet: r.content.slice(0, 450),
    score,
  });

  // Detect mismatched hardware/quantity units across semantically related chunks
  const extractMetrics = (text: string): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    const rx = /\b(\d+(?:\.\d+)?)\s*(GB|MB|TB|vCPU|cores?|days?|hours?|ms|%)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const unit = m[2].toLowerCase().replace(/s$/, "");
      if (!map.has(unit)) map.set(unit, new Set());
      map.get(unit)!.add(m[1]);
    }
    return map;
  };

  const parsedChunks = permitted.map((r) => ({
    row: r,
    vec: JSON.parse(r.embedding_json) as number[],
    metrics: extractMetrics(r.content),
  }));

  for (let i = 0; i < parsedChunks.length; i++) {
    for (let j = i + 1; j < parsedChunks.length; j++) {
      const a = parsedChunks[i];
      const b = parsedChunks[j];
      if (a.row.note_id === b.row.note_id) continue;

      const pairKey = [a.row.note_id, b.row.note_id].sort().join(":");
      if (seenPairs.has(pairKey)) continue;

      const sim = cosineSimilarity(a.vec, b.vec);
      if (sim < 0.28) continue;

      // Check numeric conflicts on shared units
      let conflictUnit: string | null = null;
      let valsA = "";
      let valsB = "";
      for (const [unit, setA] of a.metrics.entries()) {
        const setB = b.metrics.get(unit);
        if (!setB) continue;
        const diff = Array.from(setA).some((v) => !setB.has(v));
        if (diff) {
          conflictUnit = unit.toUpperCase();
          valsA = Array.from(setA).join("/");
          valsB = Array.from(setB).join("/");
          break;
        }
      }

      if (conflictUnit) {
        seenPairs.add(pairKey);
        findings.push({
          kind: "numeric-mismatch",
          summary: `Potential conflicting ${conflictUnit} specification between "${a.row.title}" (${valsA} ${conflictUnit}) and "${b.row.title}" (${valsB} ${conflictUnit}).`,
          citations: [toCitation(a.row, sim), toCitation(b.row, sim)],
        });
      } else if (sim >= 0.62) {
        seenPairs.add(pairKey);
        findings.push({
          kind: "duplicate-overlap",
          summary: `High semantic overlap (${Math.round(sim * 100)}%) between "${a.row.title}" and "${b.row.title}" — consider consolidating or cross-linking.`,
          citations: [toCitation(a.row, sim), toCitation(b.row, sim)],
        });
      }
      if (findings.length >= 6) return findings;
    }
  }

  return findings;
}

/** Synthesize a grounded NotebookLM-style answer strictly from retrieved citations. */
export function generateLocalGroundedSynthesis(
  query: string,
  citations: RagCitation[],
  scopeDescription: string,
): string {
  const lower = query.toLowerCase();

  if (citations.length === 0) {
    return [
      `No permitted notes matched your query in **${scopeDescription}**.`,
      ``,
      `> Note: Folders marked \`deny\` in **AI Access Rules** (e.g., \`Private/\`) are excluded before search.`,
    ].join("\n");
  }

  const lines: string[] = [];
  if (/contradict|conflict|outdated|duplicate|overlap/.test(lower)) {
    const scopeWs = citations[0].workspaceId;
    const issues = analyzeContradictionsAndDuplicates(scopeWs, /all/.test(lower));
    if (issues.length > 0) {
      lines.push(`### Consistency & Duplicate Analysis (${scopeDescription})`);
      for (const issue of issues) {
        const refs = issue.citations
          .map((c) => `[[${c.title}]] (\`${c.relPath}#L${c.startLine}-L${c.endLine}\`)`)
          .join(" vs. ");
        lines.push(`- **${issue.kind === "numeric-mismatch" ? "Potential Contradiction" : "Overlap"}:** ${issue.summary}\n  Sources: ${refs}`);
      }
      lines.push("");
    }
  }

  lines.push(`### Grounded Answer (${scopeDescription})`);
  lines.push(
    `Based on **${citations.length}** relevant section(s) retrieved from your Markdown vaults:`,
  );
  lines.push("");

  const seenNotes = new Set<string>();
  for (const c of citations.slice(0, 5)) {
    const tag = seenNotes.has(c.noteId) ? "Supporting section" : "Primary source";
    seenNotes.add(c.noteId);
    const cleanedExcerpt = c.snippet
      .replace(/^---[\s\S]*?---\s*/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .slice(0, 3)
      .join(" ");

    lines.push(
      `- **${c.title} → ${c.heading}** (\`${c.relPath}#L${c.startLine}-L${c.endLine}\`, ${tag}): ${cleanedExcerpt.slice(0, 260)}${cleanedExcerpt.length > 260 ? "..." : ""}`,
    );
  }

  lines.push("");
  lines.push(
    `*Click any source citation chip below to jump directly to the note and highlight the referenced lines.*`,
  );

  return lines.join("\n");
}
