import { getDb } from "./db";
import { extractWorkspaceTasks } from "./indexer";
import { TaskItem } from "./types";

export interface CortexQueryRow {
  noteId: string;
  relPath: string;
  title: string;
  objectType: string;
  values: Record<string, string>;
}

export interface CortexQueryResult {
  query: string;
  view: "table" | "list" | "tasks";
  fields: string[];
  rows: CortexQueryRow[];
  tasks: TaskItem[];
  totalMatched: number;
  error?: string;
}

interface ParsedQuery {
  view: "table" | "list" | "tasks";
  fields: string[];
  fromFolder?: string;
  fromTag?: string;
  wheres: Array<{
    field: string;
    op: "=" | "!=" | "contains" | ">" | "<" | ">=" | "<=";
    value: string;
  }>;
  sortField: string;
  sortDir: "asc" | "desc";
  limit: number;
}

interface IndexedNoteMeta {
  id: string;
  rel_path: string;
  title: string;
  folder: string;
  object_type: string;
  frontmatter_json: string;
  tags_json: string;
  word_count: number;
  updated_at: number;
}

export function extractCortexQueryBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /(?:^|\n)```cortex-query[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const q = match[1].trim();
    if (q) blocks.push(q);
  }
  return blocks;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseCortexQuery(rawQuery: string): ParsedQuery {
  const lines = rawQuery
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("# "));

  const parsed: ParsedQuery = {
    view: "table",
    fields: ["title", "type", "status", "tags", "updated"],
    wheres: [],
    sortField: "updated",
    sortDir: "desc",
    limit: 50,
  };

  for (const line of lines) {
    const viewM = /^VIEW\s+(table|list|tasks)\b/i.exec(line);
    if (viewM) {
      parsed.view = viewM[1].toLowerCase() as "table" | "list" | "tasks";
      continue;
    }

    const fieldsM = /^FIELDS\s+(.+)$/i.exec(line);
    if (fieldsM) {
      const f = fieldsM[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (f.length > 0) parsed.fields = f;
      continue;
    }

    const fromM = /^FROM\s+(.+)$/i.exec(line);
    if (fromM) {
      const raw = stripQuotes(fromM[1]).trim();
      if (raw.startsWith("#")) {
        parsed.fromTag = raw.slice(1).toLowerCase();
      } else {
        parsed.fromFolder = raw.replace(/^\/+|\/+$/g, "").toLowerCase();
      }
      continue;
    }

    const whereM = /^WHERE\s+([A-Za-z0-9_.-]+)\s*(CONTAINS|>=|<=|!=|=|>|<)\s*(.+)$/i.exec(line);
    if (whereM) {
      parsed.wheres.push({
        field: whereM[1].trim().toLowerCase(),
        op: whereM[2].toLowerCase() as ParsedQuery["wheres"][number]["op"],
        value: stripQuotes(whereM[3]).trim(),
      });
      continue;
    }

    const sortM = /^SORT\s+([A-Za-z0-9_.-]+)(?:\s+(ASC|DESC))?/i.exec(line);
    if (sortM) {
      parsed.sortField = sortM[1].trim().toLowerCase();
      parsed.sortDir = (sortM[2] || "desc").toLowerCase() === "asc" ? "asc" : "desc";
      continue;
    }

    const limitM = /^LIMIT\s+(\d+)/i.exec(line);
    if (limitM) {
      parsed.limit = Math.max(1, Math.min(200, Number(limitM[1])));
      continue;
    }
  }

  return parsed;
}

function getFieldString(
  note: IndexedNoteMeta,
  fm: Record<string, unknown>,
  tags: string[],
  field: string,
): string {
  const key = field.toLowerCase();
  if (key === "title") return note.title;
  if (key === "relpath" || key === "path") return note.rel_path;
  if (key === "folder") return note.folder || "/";
  if (key === "type" || key === "objecttype") return String(fm.type || note.object_type || "note");
  if (key === "tags") return tags.map((t) => `#${t}`).join(", ");
  if (key === "words" || key === "wordcount") return String(note.word_count);
  if (key === "updated") return new Date(note.updated_at).toISOString().slice(0, 10);

  // Lookup in frontmatter case-insensitively
  for (const [k, v] of Object.entries(fm)) {
    if (k.toLowerCase() === key && v !== undefined && v !== null) {
      return Array.isArray(v) ? v.join(", ") : String(v);
    }
  }
  return "";
}

function matchesCondition(
  actualRaw: string,
  op: ParsedQuery["wheres"][number]["op"],
  expectedRaw: string,
): boolean {
  const actual = actualRaw.trim().toLowerCase();
  const expected = expectedRaw.trim().toLowerCase();
  if (op === "=") return actual === expected;
  if (op === "!=") return actual !== expected;
  if (op === "contains") return actual.includes(expected);

  const aNum = Number(actual);
  const eNum = Number(expected);
  const bothNum = !Number.isNaN(aNum) && !Number.isNaN(eNum) && actual !== "" && expected !== "";
  if (op === ">") return bothNum ? aNum > eNum : actual > expected;
  if (op === "<") return bothNum ? aNum < eNum : actual < expected;
  if (op === ">=") return bothNum ? aNum >= eNum : actual >= expected;
  if (op === "<=") return bothNum ? aNum <= eNum : actual <= expected;
  return true;
}

export function executeCortexQuery(
  workspaceId: string,
  rawQuery: string,
): CortexQueryResult {
  const parsed = parseCortexQuery(rawQuery);
  const db = getDb();

  if (parsed.view === "tasks") {
    let tasks = extractWorkspaceTasks(workspaceId);
    if (parsed.fromFolder) {
      const f = parsed.fromFolder;
      tasks = tasks.filter((t) => t.relPath.toLowerCase().startsWith(`${f}/`) || t.relPath.toLowerCase() === f);
    }
    if (parsed.fromTag) {
      const tag = parsed.fromTag;
      tasks = tasks.filter((t) => t.tags.map((x) => x.toLowerCase()).includes(tag));
    }
    for (const w of parsed.wheres) {
      tasks = tasks.filter((t) => {
        let actual = "";
        if (w.field === "done" || w.field === "completed") actual = String(t.completed);
        else if (w.field === "status") actual = t.status;
        else if (w.field === "priority") actual = t.priority || "";
        else if (w.field === "text" || w.field === "title") actual = t.text;
        else if (w.field === "path" || w.field === "relpath") actual = t.relPath;
        else if (w.field === "tags") actual = t.tags.join(", ");
        return matchesCondition(actual, w.op, w.value);
      });
    }
    const totalMatched = tasks.length;
    return {
      query: rawQuery,
      view: "tasks",
      fields: ["text", "status", "priority", "path"],
      rows: [],
      tasks: tasks.slice(0, parsed.limit),
      totalMatched,
    };
  }

  const allNotes = db
    .prepare(
      `SELECT id, rel_path, title, folder, object_type, frontmatter_json, tags_json, word_count, updated_at
       FROM notes
       WHERE workspace_id = ? AND is_trashed = 0`,
    )
    .all(workspaceId) as unknown as IndexedNoteMeta[];

  const enriched = allNotes.map((n) => {
    let fm: Record<string, unknown> = {};
    let tags: string[] = [];
    try {
      fm = JSON.parse(n.frontmatter_json || "{}") as Record<string, unknown>;
    } catch {
      fm = {};
    }
    try {
      tags = JSON.parse(n.tags_json || "[]") as string[];
    } catch {
      tags = [];
    }
    return { note: n, fm, tags };
  });

  const filtered = enriched.filter(({ note, fm, tags }) => {
    if (parsed.fromFolder) {
      const folderLower = (note.folder || "").toLowerCase();
      const relLower = note.rel_path.toLowerCase();
      if (
        folderLower !== parsed.fromFolder &&
        !folderLower.startsWith(`${parsed.fromFolder}/`) &&
        !relLower.startsWith(`${parsed.fromFolder}/`)
      ) {
        return false;
      }
    }
    if (parsed.fromTag) {
      if (!tags.some((t) => t.toLowerCase() === parsed.fromTag)) return false;
    }
    for (const w of parsed.wheres) {
      const actual = getFieldString(note, fm, tags, w.field);
      if (!matchesCondition(actual, w.op, w.value)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const aVal =
      parsed.sortField === "updated"
        ? a.note.updated_at
        : getFieldString(a.note, a.fm, a.tags, parsed.sortField);
    const bVal =
      parsed.sortField === "updated"
        ? b.note.updated_at
        : getFieldString(b.note, b.fm, b.tags, parsed.sortField);

    let cmp = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
    }
    return parsed.sortDir === "asc" ? cmp : -cmp;
  });

  const totalMatched = filtered.length;
  const limited = filtered.slice(0, parsed.limit);

  const rows: CortexQueryRow[] = limited.map(({ note, fm, tags }) => {
    const values: Record<string, string> = {};
    for (const f of parsed.fields) {
      values[f] = getFieldString(note, fm, tags, f);
    }
    return {
      noteId: note.id,
      relPath: note.rel_path,
      title: note.title,
      objectType: note.object_type,
      values,
    };
  });

  return {
    query: rawQuery,
    view: parsed.view,
    fields: parsed.fields,
    rows,
    tasks: [],
    totalMatched,
  };
}
