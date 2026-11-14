import { getDb } from "@/lib/db";
import { createWorkspaceAclChecker } from "./acl";
import {
  computeLocalEmbedding,
  cosineSimilarity,
  getParsedEmbedding,
  STOPWORDS,
} from "./embeddings";

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

function stripFrontmatterAndNormalize(raw: string): string {
  return raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Build the untrusted-data context block passed to external LLMs/CLIs with dedupe and char budgeting. */
export function buildUntrustedContextBlock(
  citations: RagCitation[],
  maxTotalChars = 4200,
): string {
  if (citations.length === 0) {
    return "<knowledge_base_context>No permitted matching notes found.</knowledge_base_context>";
  }

  interface MergedSection {
    noteId: string;
    workspaceSlug: string;
    relPath: string;
    headings: string[];
    startLine: number;
    endLine: number;
    text: string;
  }

  const merged: MergedSection[] = [];
  for (const c of citations) {
    const cleanSnippet = stripFrontmatterAndNormalize(sanitizeUntrustedNoteText(c.snippet));
    if (!cleanSnippet) continue;
    const headingLabel = c.heading || c.title;

    const existing = merged.find(
      (m) =>
        m.noteId === c.noteId &&
        c.startLine <= m.endLine + 2 &&
        c.endLine >= m.startLine - 2,
    );

    if (existing) {
      existing.startLine = Math.min(existing.startLine, c.startLine);
      existing.endLine = Math.max(existing.endLine, c.endLine);
      if (headingLabel && !existing.headings.includes(headingLabel)) {
        existing.headings.push(headingLabel);
      }
      if (!existing.text.includes(cleanSnippet)) {
        existing.text = `${existing.text}\n${cleanSnippet}`;
      }
    } else {
      merged.push({
        noteId: c.noteId,
        workspaceSlug: c.workspaceSlug,
        relPath: c.relPath,
        headings: headingLabel ? [headingLabel] : [c.title],
        startLine: c.startLine,
        endLine: c.endLine,
        text: cleanSnippet,
      });
    }
  }

  if (merged.length === 0) {
    return "<knowledge_base_context>No permitted matching notes found.</knowledge_base_context>";
  }

  const blocks: string[] = [];
  let totalChars = 0;
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    const header = `<untrusted_note_data index="${i + 1}" workspace="${m.workspaceSlug}" path="${m.relPath}" heading="${m.headings.join(" / ")}" lines="L${m.startLine}-L${m.endLine}">`;
    const footer = `</untrusted_note_data>`;
    const wrapperCost = header.length + footer.length + 4;
    const remaining = maxTotalChars - totalChars - wrapperCost;
    if (remaining <= 60 && blocks.length > 0) break;

    const body =
      remaining > 0 && m.text.length > remaining
        ? `${m.text.slice(0, Math.max(40, remaining - 3)).trimEnd()}...`
        : m.text;
    const block = `${header}\n${body}\n${footer}`;
    blocks.push(block);
    totalChars += block.length + 2;
  }

  return blocks.join("\n\n");
}

function buildSafeFtsQuery(query: string): string {
  const rawTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const meaningful = rawTokens.filter((t) => !STOPWORDS.has(t));
  const tokens = (meaningful.length > 0 ? meaningful : rawTokens).slice(0, 10);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
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

  // Enforce AI Folder ACL BEFORE scoring/returning any document content (1 query per workspace)
  const checkAcl = createWorkspaceAclChecker();
  const permitted = candidateRows.filter((row) =>
    checkAcl(row.workspace_id, row.rel_path),
  );
  if (permitted.length === 0) return [];

  // 2. Keyword FTS5 scores per note_id (weighted: title=5, tags=3, rel_path=2, body=1)
  const ftsBoostByNote = new Map<string, number>();
  const ftsQuery = buildSafeFtsQuery(query);
  if (ftsQuery) {
    try {
      let ftsSql = `SELECT note_id, bm25(notes_fts, 0.0, 0.0, 2.0, 5.0, 3.0, 1.0) as rank FROM notes_fts WHERE notes_fts MATCH ?`;
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

  // 3. Hybrid Reciprocal Rank Fusion + Word-Boundary Exact Term Overlap
  const rawQueryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const meaningfulTerms = rawQueryTerms.filter((w) => !STOPWORDS.has(w));
  const queryTerms = meaningfulTerms.length > 0 ? meaningfulTerms : rawQueryTerms;

  const scored = permitted.map((row) => {
    const vec = getParsedEmbedding(row.chunk_id, row.embedding_json);
    const semScore = cosineSimilarity(queryVec, vec);
    const ftsBonus = ftsBoostByNote.get(row.note_id) || 0;
    const lowerText = `${row.title} ${row.heading} ${row.content}`.toLowerCase();
    const rowTokens = new Set(lowerText.split(/[^a-z0-9_-]+/).filter(Boolean));
    let termHits = 0;
    for (const t of queryTerms) {
      if (rowTokens.has(t) || (t.length >= 5 && lowerText.includes(t))) {
        termHits++;
      }
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
  if (scope.mode === "note") {
    return scored.slice(0, limit);
  }

  // Cap per-note diversity in multi-note retrieval so one long file cannot crowd out other sources
  const selected: RagCitation[] = [];
  const overflow: RagCitation[] = [];
  const countByNote = new Map<string, number>();

  for (const item of scored) {
    const cnt = countByNote.get(item.noteId) ?? 0;
    if (cnt < 2 && selected.length < limit) {
      selected.push(item);
      countByNote.set(item.noteId, cnt + 1);
    } else {
      overflow.push(item);
    }
  }
  while (selected.length < limit && overflow.length > 0) {
    selected.push(overflow.shift()!);
  }
  return selected;
}

/**
 * Scan permitted notes for semantic duplicates and potential numeric/spec contradictions.
 */
export function analyzeContradictionsAndDuplicates(
  workspaceId: string,
  allWorkspaces = false,
): ContradictionFinding[] {
  const db = getDb();
  const sql = `
    SELECT c.id as chunk_id, c.note_id, c.workspace_id, w.slug as workspace_slug, n.rel_path, n.title,
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

  const checkAcl = createWorkspaceAclChecker();
  const permitted = rows.filter((r) => checkAcl(r.workspace_id, r.rel_path));
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
    vec: getParsedEmbedding(r.chunk_id, r.embedding_json),
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
