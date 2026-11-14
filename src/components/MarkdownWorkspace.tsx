"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked, Renderer } from "marked";
import {
  AlertTriangle,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code,
  Columns2,
  Copy,
  Eye,
  FileCode2,
  Heading1,
  Heading2,
  History,
  Link2,
  ListTree,
  Network,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { renderMathExpressions, renderMermaidToSvg } from "@/lib/render-rich";
import {
  BacklinkItem,
  ConflictState,
  CortexQueryResultItem,
  GraphData,
  HeadingItem,
  NoteDetail,
  NoteSummary,
  OutgoingLinkItem,
  RelatedNoteItem,
  TransclusionEntry,
  UnlinkedMentionItem,
  VersionItem,
} from "@/lib/types";

interface InlineRewriteResult {
  replacementText: string;
  diffPreview: string;
  fallbackWarning?: string;
}

interface MarkdownWorkspaceProps {
  workspaceSlug: string;
  workspaceNotes: NoteSummary[];
  openTabs: Array<{ id: string; title: string; relPath: string }>;
  activeNote: NoteDetail | null;
  draftContent: string;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  headings: HeadingItem[];
  outgoingLinks: OutgoingLinkItem[];
  backlinks: BacklinkItem[];
  unlinkedMentions: UnlinkedMentionItem[];
  relatedNotes: RelatedNoteItem[];
  versions: VersionItem[];
  localGraph: GraphData;
  transclusions?: Record<string, TransclusionEntry>;
  queryResults?: Record<string, CortexQueryResultItem>;
  highlightLines: { start: number; end: number } | null;
  conflict: ConflictState | null;
  onClearHighlight: () => void;
  onSelectTab: (noteId: string) => void;
  onCloseTab: (noteId: string) => void;
  onChangeDraft: (nextContent: string) => void;
  onSaveNow: (forceOverwrite?: boolean) => void;
  onToggleFavorite: () => void;
  onTogglePin: () => void;
  onTrashNote: () => void;
  onRenameNote?: (newRelPath: string) => Promise<void>;
  onInlineRewrite?: (payload: {
    selectedText: string;
    instruction: string;
    noteRelPath: string;
  }) => Promise<InlineRewriteResult>;
  onUploadAttachment: (file: File) => Promise<string | null>;
  onOpenNoteById: (noteId: string, line?: number) => void;
  onOpenOrCreateWikiLink: (targetName: string) => void;
  onLinkMention: (mention: UnlinkedMentionItem) => Promise<void>;
  onRestoreVersion: (versionId: string) => Promise<void>;
  onResolveConflict: (
    choice: "server" | "local" | "merge",
    mergedContent?: string,
  ) => void;
  onToggleCheckboxLine: (lineNumber: number) => Promise<void>;
  onAskAiAboutNote: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeHtmlOutput(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?(iframe|object|embed|form)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');
}

function stripFrontmatter(md: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

function upsertTagInMarkdown(
  raw: string,
  tagToAdd?: string,
  tagToRemove?: string,
): string {
  const cleanTag = (t: string) => t.replace(/^#/, "").trim().toLowerCase();
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);

  const parseExistingTags = (fmBlock: string): string[] => {
    const inlineMatch = /^tags:\s*\[([^\]]*)\]/m.exec(fmBlock);
    if (inlineMatch) {
      return inlineMatch[1]
        .split(",")
        .map((s) => cleanTag(s.replace(/["']/g, "")))
        .filter(Boolean);
    }
    const listMatch = /^tags:\s*\r?\n((?:\s*-\s+.*\r?\n?)*)/m.exec(fmBlock);
    if (listMatch) {
      return listMatch[1]
        .split(/\r?\n/)
        .map((l) => cleanTag(l.replace(/^\s*-\s+/, "")))
        .filter(Boolean);
    }
    return [];
  };

  if (!fmMatch) {
    if (!tagToAdd) return raw;
    const t = cleanTag(tagToAdd);
    if (!t) return raw;
    return `---\ntype: note\ntags: [${t}]\n---\n\n${raw}`;
  }

  let fmBody = fmMatch[1];
  const tags = parseExistingTags(fmBody);
  const nextSet = new Set(tags);
  if (tagToAdd && cleanTag(tagToAdd)) nextSet.add(cleanTag(tagToAdd));
  if (tagToRemove) nextSet.delete(cleanTag(tagToRemove));
  const newTagsLine = `tags: [${Array.from(nextSet).join(", ")}]`;

  if (/^tags:\s*\[[^\]]*\]/m.test(fmBody)) {
    fmBody = fmBody.replace(/^tags:\s*\[[^\]]*\]/m, newTagsLine);
  } else if (/^tags:\s*\r?\n(?:\s*-\s+.*\r?\n?)*/m.test(fmBody)) {
    fmBody = fmBody.replace(/^tags:\s*\r?\n(?:\s*-\s+.*\r?\n?)*/m, `${newTagsLine}\n`);
  } else {
    fmBody = `${fmBody.trimEnd()}\n${newTagsLine}`;
  }

  const after = raw.slice(fmMatch[0].length);
  return `---\n${fmBody.trimEnd()}\n---\n${after.startsWith("\n") ? after : `\n${after}`}`;
}

const MEDIA_EMBED_RE =
  /\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|wav|m4a|ogg|webm|avif)$/i;

const REWRITE_PRESETS = [
  { label: "Tighten", instruction: "Make concise and tighten wording" },
  { label: "Bullets", instruction: "Convert into clean bullet points" },
  { label: "Checklist", instruction: "Convert into actionable checklist tasks" },
  { label: "Table", instruction: "Format key items into a Markdown table" },
  { label: "Expand", instruction: "Expand with supporting details and next steps" },
  { label: "Polish", instruction: "Polish grammar, clarity, and Markdown formatting" },
];

function splitFrontmatterSection(raw: string): {
  rawFmWithNewline: string;
  fmLineCount: number;
  bodyAfterFm: string;
} | null {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!m) return null;
  const rawFmWithNewline = m[0];
  const fmLineCount = rawFmWithNewline.endsWith("\n")
    ? rawFmWithNewline.split(/\r?\n/).length - 1
    : rawFmWithNewline.split(/\r?\n/).length;
  return {
    rawFmWithNewline,
    fmLineCount,
    bodyAfterFm: raw.slice(rawFmWithNewline.length),
  };
}

function parseFrontmatterEntries(raw: string): Array<{ key: string; value: string }> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return [];
  const rows: Array<{ key: string; value: string }> = [];
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    if (key.toLowerCase() === "tags") continue;
    const val = kv[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    rows.push({ key, value: val });
  }
  return rows;
}

function upsertFrontmatterProperty(
  raw: string,
  keyInput: string,
  valueInput: string | null,
): string {
  const key = keyInput.trim().replace(/[^A-Za-z0-9_-]/g, "_");
  if (!key) return raw;

  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!fmMatch) {
    if (valueInput === null) return raw;
    return `---\n${key}: ${valueInput}\n---\n\n${raw}`;
  }

  const lines = fmMatch[1].split(/\r?\n/);
  const re = new RegExp(`^${key}\\s*:`);
  let found = false;
  const nextLines: string[] = [];

  for (const line of lines) {
    if (re.test(line)) {
      found = true;
      if (valueInput !== null) {
        nextLines.push(`${key}: ${valueInput}`);
      }
    } else {
      nextLines.push(line);
    }
  }
  if (!found && valueInput !== null) {
    nextLines.push(`${key}: ${valueInput}`);
  }

  const after = raw.slice(fmMatch[0].length);
  return `---\n${nextLines.join("\n").trimEnd()}\n---\n${after.startsWith("\n") ? after : `\n${after}`}`;
}

function renderQueryCardHtml(queryText: string, result?: CortexQueryResultItem): string {
  if (!result) {
    return `<div class="my-3 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 text-xs text-zinc-400"><div class="font-semibold text-emerald-400 mb-1">Cortex Query Block (Save note to refresh)</div><pre class="m-0 text-[11px]">${escapeHtml(queryText)}</pre></div>`;
  }
  if (result.view === "tasks") {
    const items = result.tasks
      .map(
        (t) =>
          `<div class="flex items-center justify-between gap-2 py-1 border-b border-zinc-800/60 last:border-b-0"><span class="${t.completed ? "line-through text-zinc-500" : "text-zinc-200"}">${t.completed ? "☑" : "☐"} ${t.priority ? `[#${escapeHtml(t.priority)}] ` : ""}${escapeHtml(t.text)}</span><a href="#" data-query-note-id="${escapeHtml(t.noteId)}" data-query-line="${t.lineNumber}" class="text-[11px] font-mono text-emerald-400 hover:underline shrink-0">${escapeHtml(t.relPath)}#L${t.lineNumber}</a></div>`,
      )
      .join("");
    return `<div class="my-3 rounded-xl border border-emerald-500/30 bg-[#0d1016] overflow-hidden"><div class="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] font-semibold text-emerald-300 flex justify-between"><span>Cortex Query (Tasks)</span><span>${result.totalMatched} match(es)</span></div><div class="p-3 text-xs">${items || '<em class="text-zinc-500">No matching tasks.</em>'}</div></div>`;
  }
  if (result.view === "list") {
    const items = result.rows
      .map(
        (r) =>
          `<li class="py-0.5"><a href="#" data-query-note-id="${escapeHtml(r.noteId)}" class="text-emerald-400 hover:underline font-medium">${escapeHtml(r.title)}</a> <span class="text-[11px] text-zinc-500 font-mono">(${escapeHtml(r.relPath)})</span></li>`,
      )
      .join("");
    return `<div class="my-3 rounded-xl border border-emerald-500/30 bg-[#0d1016] overflow-hidden"><div class="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] font-semibold text-emerald-300 flex justify-between"><span>Cortex Query (List)</span><span>${result.totalMatched} match(es)</span></div><div class="p-3 text-xs"><ul class="m-0 pl-4">${items || '<li class="text-zinc-500">No matching notes.</li>'}</ul></div></div>`;
  }

  const ths = result.fields.map((f) => `<th>${escapeHtml(f)}</th>`).join("");
  const trs = result.rows
    .map((r) => {
      const tds = result.fields
        .map((f) => {
          const val = r.values[f] || "—";
          if (f.toLowerCase() === "title") {
            return `<td><a href="#" data-query-note-id="${escapeHtml(r.noteId)}" class="text-emerald-400 hover:underline font-medium">${escapeHtml(val)}</a></td>`;
          }
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<div class="my-3 rounded-xl border border-emerald-500/30 bg-[#0d1016] overflow-hidden"><div class="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] font-semibold text-emerald-300 flex justify-between"><span>Cortex Query (Table)</span><span>${result.totalMatched} match(es)</span></div><div class="overflow-x-auto"><table class="m-0 w-full"><thead><tr>${ths}</tr></thead><tbody>${trs || `<tr><td colspan="${result.fields.length}" class="text-zinc-500">No matching notes.</td></tr>`}</tbody></table></div></div>`;
}

function renderMarkdownFragment(
  rawMd: string,
  workspaceSlug: string,
  transclusions?: Record<string, TransclusionEntry>,
  queryResults?: Record<string, CortexQueryResultItem>,
): string {
  let body = stripFrontmatter(rawMd);

  // Protect fenced code blocks & inline code spans while expanding ![[...]] and [[...]]
  const codeTokens: string[] = [];
  const mask = (raw: string) => {
    const token = `@@CMFRAG_${codeTokens.length}@@`;
    codeTokens.push(raw);
    return token;
  };
  body = body.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (m) => mask(m));
  body = body.replace(/`[^`\n]+`/g, (m) => mask(m));

  // Resolve ![[...]] media embeds vs note/heading transclusions
  body = body.replace(
    /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, target: string, alt?: string) => {
      const clean = target.trim();
      if (MEDIA_EMBED_RE.test(clean)) {
        const url = `/api/attachments?workspaceSlug=${encodeURIComponent(workspaceSlug)}&path=${encodeURIComponent(clean)}`;
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || clean)}" />`;
      }

      if (!transclusions) {
        return `<a href="#" class="wikilink-chip" data-wikilink="${escapeHtml(clean.split("#")[0].trim())}">${escapeHtml(clean)}</a>`;
      }

      const keyLower = clean.toLowerCase();
      const entry =
        transclusions[clean] ||
        Object.values(transclusions).find((t) => t.raw.toLowerCase() === keyLower);
      const baseTarget = clean.split("#")[0].trim();

      if (!entry || !entry.found || !entry.content.trim()) {
        const msg = entry?.heading
          ? `Section "${entry.heading}" not found in [[${baseTarget}]]`
          : `Transclusion target [[${baseTarget}]] not found`;
        return `\n<div class="transclusion-card" data-transclude-target="${escapeHtml(baseTarget)}"><div class="transclusion-header"><span>![[${escapeHtml(clean)}]]</span><span>Open Note &rarr;</span></div><div class="transclusion-body"><em>${escapeHtml(msg)}</em></div></div>\n`;
      }

      const headerTitle = `${entry.title || baseTarget}${entry.heading ? ` › #${entry.heading}` : ""}`;
      const renderedInner = renderMarkdownFragment(entry.content, workspaceSlug);
      return `\n<div class="transclusion-card" data-transclude-note-id="${escapeHtml(entry.noteId || "")}" data-transclude-target="${escapeHtml(baseTarget)}"><div class="transclusion-header"><span>${escapeHtml(headerTitle)}</span><span>Open &nearr;</span></div><div class="transclusion-body">${renderedInner}</div></div>\n`;
    },
  );

  // Transform [[WikiLink]] or [[WikiLink|Alias]]
  body = body.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, target: string, alias?: string) => {
      const cleanTarget = target.trim();
      const label = (alias || cleanTarget).trim();
      return `<a href="#" class="wikilink-chip" data-wikilink="${escapeHtml(cleanTarget)}">${escapeHtml(label)}</a>`;
    },
  );

  // Restore code tokens before math + marked code rendering
  body = body.replace(/@@CMFRAG_(\d+)@@/g, (_m, i: string) => codeTokens[Number(i)] ?? "");
  body = renderMathExpressions(body);

  const renderer = new Renderer();
  renderer.code = ({ text, lang }) => {
    const cleanLang = (lang || "").trim().toLowerCase();
    if (cleanLang === "mermaid") {
      return `<div class="cortex-mermaid-wrap">${renderMermaidToSvg(text)}</div>`;
    }
    if (cleanLang === "cortex-query") {
      const trimmedQ = text.trim();
      const matched =
        queryResults?.[trimmedQ] ||
        Object.values(queryResults || {}).find((r) => r.query.trim() === trimmedQ);
      return renderQueryCardHtml(trimmedQ, matched);
    }
    return `<pre><code class="language-${escapeHtml(cleanLang || "text")}">${escapeHtml(text)}</code></pre>`;
  };

  const rawHtml = marked.parse(body, { gfm: true, breaks: true, renderer }) as string;
  return sanitizeHtmlOutput(rawHtml);
}

const SLASH_ITEMS = [
  { cmd: "/h1", label: "Heading 1", snippet: "# " },
  { cmd: "/h2", label: "Heading 2", snippet: "## " },
  { cmd: "/task", label: "Checklist Task", snippet: "- [ ] " },
  { cmd: "/code", label: "Code Block", snippet: "```ts\n\n```\n" },
  { cmd: "/callout", label: "Callout Quote", snippet: "> **Note:** " },
  {
    cmd: "/table",
    label: "Markdown Table",
    snippet: "| Column A | Column B |\n| --- | --- |\n| Value 1 | Value 2 |\n",
  },
  { cmd: "/link", label: "Internal WikiLink", snippet: "[[]]" },
];

export function MarkdownWorkspace({
  workspaceSlug,
  workspaceNotes,
  openTabs,
  activeNote,
  draftContent,
  dirty,
  saving,
  lastSavedAt,
  headings,
  backlinks,
  unlinkedMentions,
  relatedNotes,
  versions,
  localGraph,
  transclusions = {},
  queryResults = {},
  highlightLines,
  conflict,
  onClearHighlight,
  onSelectTab,
  onCloseTab,
  onChangeDraft,
  onSaveNow,
  onToggleFavorite,
  onTogglePin,
  onTrashNote,
  onRenameNote,
  onInlineRewrite,
  onUploadAttachment,
  onOpenNoteById,
  onOpenOrCreateWikiLink,
  onLinkMention,
  onRestoreVersion,
  onResolveConflict,
  onToggleCheckboxLine,
  onAskAiAboutNote,
}: MarkdownWorkspaceProps) {
  const [viewMode, setViewMode] = useState<"split" | "edit" | "preview" | "graph">(
    "split",
  );
  const [inspectorTab, setInspectorTab] = useState<
    "backlinks" | "mentions" | "related" | "outline" | "history" | null
  >("backlinks");
  const [newTagInput, setNewTagInput] = useState("");
  const [wikiQuery, setWikiQuery] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionItem | null>(null);

  // Item 4: Editor gutter, cursor line & YAML fold
  const [frontmatterFolded, setFrontmatterFolded] = useState(false);
  const [activeCursorLine, setActiveCursorLine] = useState(1);

  // Item 8: Typed YAML Properties Grid
  const [propsExpanded, setPropsExpanded] = useState(false);
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropVal, setNewPropVal] = useState("");

  // Item 5: Inline Rename / Move UI
  const [renamingOpen, setRenamingOpen] = useState(false);
  const [renamePathInput, setRenamePathInput] = useState("");
  const [renamingBusy, setRenamingBusy] = useState(false);
  const [renameError, setRenameError] = useState("");

  // Item 3: Inline AI Rewrite (Ctrl+I)
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteRange, setRewriteRange] = useState<{
    start: number;
    end: number;
    selectedText: string;
  } | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("Make concise and tighten wording");
  const [rewriteResult, setRewriteResult] = useState<InlineRewriteResult | null>(null);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteError, setRewriteError] = useState("");

  // Item 19: Hover WikiLink Preview Popover
  const [hoveredWikiPreview, setHoveredWikiPreview] = useState<{
    title: string;
    relPath: string;
    tags: string[];
    objectType: string;
    wordCount: number;
    x: number;
    y: number;
  } | null>(null);

  // Item 24: Per-hunk 3-way conflict resolution choices
  const [hunkChoices, setHunkChoices] = useState<
    Record<number, "local" | "server" | "both">
  >({});

  const mergeHunks = useMemo(() => {
    if (!conflict) return [];
    const localBlocks = conflict.localContent.split(/\n{2,}/);
    const serverBlocks = conflict.serverContent.split(/\n{2,}/);
    const maxLen = Math.max(localBlocks.length, serverBlocks.length);
    const hunks: Array<{
      index: number;
      same: boolean;
      localText: string;
      serverText: string;
    }> = [];
    for (let i = 0; i < maxLen; i++) {
      const l = localBlocks[i] ?? "";
      const s = serverBlocks[i] ?? "";
      hunks.push({
        index: i,
        same: l === s,
        localText: l,
        serverText: s,
      });
    }
    return hunks;
  }, [conflict]);

  function buildHunkMergedText(): string {
    return mergeHunks
      .map((h) => {
        if (h.same) return h.localText;
        const pick = hunkChoices[h.index] || "both";
        if (pick === "local") return h.localText;
        if (pick === "server") return h.serverText;
        return [h.serverText, h.localText].filter(Boolean).join("\n\n");
      })
      .filter((s) => s.length > 0)
      .join("\n\n");
  }

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const fmSplit = useMemo(() => splitFrontmatterSection(draftContent), [draftContent]);
  const editorVisibleValue =
    frontmatterFolded && fmSplit ? fmSplit.bodyAfterFm : draftContent;
  const lineNumberOffset = frontmatterFolded && fmSplit ? fmSplit.fmLineCount : 0;

  useEffect(() => {
    setRenamingOpen(false);
    setRenameError("");
    setRewriteOpen(false);
    setRewriteResult(null);
  }, [activeNote?.id]);

  // Focus editor cursor when citation highlight changes
  useEffect(() => {
    if (!highlightLines || !editorRef.current) return;
    if (frontmatterFolded && fmSplit && highlightLines.start <= fmSplit.fmLineCount) {
      setFrontmatterFolded(false);
    }
    const targetText = editorVisibleValue;
    const lines = targetText.split(/\r?\n/);
    const relLine = Math.max(1, highlightLines.start - lineNumberOffset);
    let offset = 0;
    for (let i = 0; i < Math.min(relLine - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    const ta = editorRef.current;
    ta.focus();
    ta.setSelectionRange(offset, offset + (lines[relLine - 1]?.length || 0));
    const approxY = Math.max(0, (relLine - 4) * 21);
    ta.scrollTop = approxY;
    if (gutterRef.current) gutterRef.current.scrollTop = approxY;
    setActiveCursorLine(highlightLines.start);
  }, [highlightLines, activeNote?.id]);

  function openInlineRewriteFromCursor() {
    if (!activeNote) return;
    const ta = editorRef.current;
    const baseOffset = frontmatterFolded && fmSplit ? fmSplit.rawFmWithNewline.length : 0;

    let start = 0;
    let end = 0;
    if (ta) {
      if (ta.selectionStart !== ta.selectionEnd) {
        start = baseOffset + ta.selectionStart;
        end = baseOffset + ta.selectionEnd;
      } else {
        const cursor = baseOffset + ta.selectionStart;
        const lineStart = draftContent.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
        const nlAfter = draftContent.indexOf("\n", cursor);
        const lineEnd = nlAfter === -1 ? draftContent.length : nlAfter;
        start = lineStart;
        end = lineEnd;
      }
    } else {
      start = 0;
      end = draftContent.length;
    }

    const snippet = draftContent.slice(start, end);
    if (!snippet.trim()) {
      setRewriteError("Place cursor on a non-empty line or select text first.");
      setRewriteRange({ start, end, selectedText: snippet });
      setRewriteResult(null);
      setRewriteOpen(true);
      return;
    }

    setRewriteError("");
    setRewriteResult(null);
    setRewriteRange({ start, end, selectedText: snippet });
    setRewriteOpen(true);
  }

  // Ctrl+S and Ctrl+I shortcuts inside workspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeNote) onSaveNow();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        if (activeNote && (viewMode === "edit" || viewMode === "split")) {
          e.preventDefault();
          openInlineRewriteFromCursor();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const parsedTags = useMemo(() => {
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(draftContent);
    if (!fmMatch) return activeNote?.tags || [];
    const inline = /^tags:\s*\[([^\]]*)\]/m.exec(fmMatch[1]);
    if (inline) {
      return inline[1]
        .split(",")
        .map((s) => s.replace(/["'#]/g, "").trim().toLowerCase())
        .filter(Boolean);
    }
    return activeNote?.tags || [];
  }, [draftContent, activeNote?.tags]);

  const parsedProperties = useMemo(
    () => parseFrontmatterEntries(draftContent),
    [draftContent],
  );

  const previewHtml = useMemo(
    () => renderMarkdownFragment(draftContent, workspaceSlug, transclusions, queryResults),
    [draftContent, workspaceSlug, transclusions, queryResults],
  );

  // Bind click events on rendered [[WikiLink]] chips, transclusion headers, query links & task checkboxes inside preview
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest("a.wikilink-chip") as HTMLElement | null;
      if (chip) {
        e.preventDefault();
        const wl = chip.getAttribute("data-wikilink");
        if (wl) onOpenOrCreateWikiLink(wl);
        return;
      }

      const queryLink = target.closest("[data-query-note-id]") as HTMLElement | null;
      if (queryLink) {
        e.preventDefault();
        const nid = queryLink.getAttribute("data-query-note-id");
        const lnRaw = queryLink.getAttribute("data-query-line");
        if (nid) onOpenNoteById(nid, lnRaw ? Number(lnRaw) : undefined);
        return;
      }

      const transcludeHdr = target.closest(".transclusion-header") as HTMLElement | null;
      if (transcludeHdr) {
        const card = transcludeHdr.closest(".transclusion-card") as HTMLElement | null;
        const noteId = card?.getAttribute("data-transclude-note-id");
        const fallbackTarget = card?.getAttribute("data-transclude-target");
        if (noteId) {
          onOpenNoteById(noteId);
        } else if (fallbackTarget) {
          onOpenOrCreateWikiLink(fallbackTarget);
        }
        return;
      }

      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        const checkboxes = Array.from(
          container.querySelectorAll('input[type="checkbox"]'),
        );
        const cbIndex = checkboxes.indexOf(target);
        if (cbIndex >= 0) {
          const lines = draftContent.split(/\r?\n/);
          let found = 0;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
              if (found === cbIndex) {
                onToggleCheckboxLine(i + 1);
                break;
              }
              found++;
            }
          }
        }
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest("a.wikilink-chip") as HTMLElement | null;
      if (!chip) return;
      const wl = chip.getAttribute("data-wikilink");
      if (!wl) return;
      const norm = wl.replace(/\.md$/i, "").trim().toLowerCase();
      const match = workspaceNotes.find(
        (n) =>
          n.title.toLowerCase() === norm ||
          n.relPath.replace(/\.md$/i, "").toLowerCase() === norm ||
          n.relPath.split("/").pop()?.replace(/\.md$/i, "").toLowerCase() === norm,
      );
      if (!match) return;
      const rect = chip.getBoundingClientRect();
      setHoveredWikiPreview({
        title: match.title,
        relPath: match.relPath,
        tags: match.tags,
        objectType: match.objectType,
        wordCount: match.wordCount,
        x: Math.min(rect.left, window.innerWidth - 290),
        y: rect.bottom + 6,
      });
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a.wikilink-chip")) {
        setHoveredWikiPreview(null);
      }
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [previewHtml, draftContent, workspaceNotes, onOpenNoteById, onOpenOrCreateWikiLink, onToggleCheckboxLine]);

  function syncCursorLine(ta: HTMLTextAreaElement) {
    const relLine = ta.value.slice(0, ta.selectionStart).split(/\r?\n/).length;
    setActiveCursorLine(lineNumberOffset + relLine);
  }

  function handleVisibleEditorChange(visibleNext: string) {
    const fullNext =
      frontmatterFolded && fmSplit ? fmSplit.rawFmWithNewline + visibleNext : visibleNext;
    handleEditorChange(fullNext);
  }

  function handleEditorChange(val: string) {
    onChangeDraft(val);
    const ta = editorRef.current;
    if (!ta) return;
    syncCursorLine(ta);
    const pos = ta.selectionStart;
    const beforeCursor = ta.value.slice(0, pos);

    const wikiMatch = /\[\[([^\]\n]*)$/.exec(beforeCursor);
    if (wikiMatch) {
      setWikiQuery(wikiMatch[1]);
      setSlashQuery(null);
      return;
    }
    setWikiQuery(null);

    const slashMatch = /(?:^|\n)(\/[a-z0-9]*)$/.exec(beforeCursor);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      return;
    }
    setSlashQuery(null);
  }

  function insertAtCursor(before: string, after = "") {
    const ta = editorRef.current;
    const baseText = editorVisibleValue;
    if (!ta) {
      handleVisibleEditorChange(`${baseText}${before}${after}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = baseText.slice(start, end);
    const next =
      baseText.slice(0, start) +
      before +
      selected +
      after +
      baseText.slice(end);
    handleVisibleEditorChange(next);
    setTimeout(() => {
      ta.focus();
      const cursor = start + before.length + selected.length;
      ta.setSelectionRange(cursor, cursor);
      syncCursorLine(ta);
    }, 0);
  }

  function applyWikiSuggestion(title: string) {
    const ta = editorRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).replace(/\[\[([^\]\n]*)$/, `[[${title}]]`);
    const after = ta.value.slice(pos);
    handleVisibleEditorChange(before + after);
    setWikiQuery(null);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(before.length, before.length);
      syncCursorLine(ta);
    }, 0);
  }

  function applySlashCommand(snippet: string) {
    const ta = editorRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).replace(/\/[a-z0-9]*$/, snippet);
    const after = ta.value.slice(pos);
    handleVisibleEditorChange(before + after);
    setSlashQuery(null);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(before.length, before.length);
      syncCursorLine(ta);
    }, 0);
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const val = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      if (start === end && !e.shiftKey) {
        const next = val.slice(0, start) + "  " + val.slice(end);
        handleVisibleEditorChange(next);
        setTimeout(() => {
          ta.setSelectionRange(start + 2, start + 2);
          syncCursorLine(ta);
        }, 0);
        return;
      }

      const lineStart = val.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nlAfterEnd = val.indexOf("\n", end);
      const lineEnd = nlAfterEnd === -1 ? val.length : nlAfterEnd;
      const block = val.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      let deltaFirst = 0;
      let deltaTotal = 0;

      const updated = lines.map((line, idx) => {
        if (e.shiftKey) {
          if (line.startsWith("  ")) {
            if (idx === 0) deltaFirst -= 2;
            deltaTotal -= 2;
            return line.slice(2);
          }
          if (line.startsWith("\t") || line.startsWith(" ")) {
            if (idx === 0) deltaFirst -= 1;
            deltaTotal -= 1;
            return line.slice(1);
          }
          return line;
        }
        if (idx === 0) deltaFirst += 2;
        deltaTotal += 2;
        return `  ${line}`;
      });

      const next = val.slice(0, lineStart) + updated.join("\n") + val.slice(lineEnd);
      handleVisibleEditorChange(next);
      setTimeout(() => {
        ta.setSelectionRange(
          Math.max(lineStart, start + deltaFirst),
          Math.max(lineStart, end + deltaTotal),
        );
        syncCursorLine(ta);
      }, 0);
    }
  }

  async function runInlineRewrite(customInstruction?: string) {
    if (!activeNote || !rewriteRange || !onInlineRewrite) return;
    if (!rewriteRange.selectedText.trim()) return;
    const instruction = (customInstruction ?? rewriteInstruction).trim() || "Polish clarity";
    setRewriteInstruction(instruction);
    setRewriteLoading(true);
    setRewriteError("");
    try {
      const result = await onInlineRewrite({
        selectedText: rewriteRange.selectedText,
        instruction,
        noteRelPath: activeNote.relPath,
      });
      setRewriteResult(result);
    } catch (err) {
      setRewriteError(err instanceof Error ? err.message : "Inline rewrite failed");
    } finally {
      setRewriteLoading(false);
    }
  }

  function applyInlineRewrite() {
    if (!rewriteRange || !rewriteResult) return;
    const nextFull =
      draftContent.slice(0, rewriteRange.start) +
      rewriteResult.replacementText +
      draftContent.slice(rewriteRange.end);
    onChangeDraft(nextFull);
    setRewriteOpen(false);
    setRewriteResult(null);
    setRewriteRange(null);
  }

  const wikiSuggestions = useMemo(() => {
    if (wikiQuery === null) return [];
    const q = wikiQuery.toLowerCase();
    return workspaceNotes
      .filter(
        (n) =>
          n.id !== activeNote?.id &&
          (n.title.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q)),
      )
      .slice(0, 7);
  }, [wikiQuery, workspaceNotes, activeNote?.id]);

  const slashSuggestions = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return SLASH_ITEMS.filter(
      (item) => item.cmd.includes(q) || item.label.toLowerCase().includes(q.slice(1)),
    );
  }, [slashQuery]);

  if (!activeNote) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#09090b]">
        <div className="max-w-md space-y-3">
          <Network className="w-10 h-10 text-emerald-500/70 mx-auto" />
          <h2 className="text-lg font-semibold text-zinc-100">
            Select or create a Markdown note
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Every note is saved directly as a standard <code className="text-emerald-300">.md</code>{" "}
            file inside your Proxmox vault directory with real-time FTS5, semantic embeddings, and backlink indexing.
          </p>
        </div>
      </div>
    );
  }

  const highlightedBlock =
    highlightLines &&
    draftContent
      .split(/\r?\n/)
      .slice(Math.max(0, highlightLines.start - 1), highlightLines.end)
      .join("\n");

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0b0b0e]">
      {/* Open Tabs Bar */}
      <div className="flex items-center gap-1 px-2 pt-1.5 bg-[#09090b] border-b border-zinc-800/80 overflow-x-auto shrink-0">
        {openTabs.map((tab) => {
          const isCurrent = tab.id === activeNote.id;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs border-x border-t cursor-pointer shrink-0 max-w-[190px] ${
                isCurrent
                  ? "bg-[#0b0b0e] border-zinc-800 text-zinc-100 font-medium"
                  : "bg-zinc-950/60 border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="truncate">{tab.title}</span>
              {isCurrent && dirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="opacity-60 hover:opacity-100 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Note Header: Breadcrumb + Mode Switcher + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800/80 bg-[#0f0f13] shrink-0">
        <div className="flex items-center gap-2 min-w-0 text-xs flex-wrap">
          {renamingOpen ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!onRenameNote || !renamePathInput.trim()) return;
                setRenamingBusy(true);
                setRenameError("");
                try {
                  await onRenameNote(renamePathInput.trim());
                  setRenamingOpen(false);
                } catch (err) {
                  setRenameError(err instanceof Error ? err.message : "Rename failed");
                } finally {
                  setRenamingBusy(false);
                }
              }}
              className="flex items-center gap-1.5 flex-wrap"
            >
              <input
                value={renamePathInput}
                onChange={(e) => setRenamePathInput(e.target.value)}
                placeholder="folder/note-name.md"
                autoFocus
                className="w-56 bg-zinc-950 border border-emerald-500/60 rounded-md px-2 py-0.5 font-mono text-xs text-zinc-100 focus:outline-none"
              />
              <button
                type="submit"
                disabled={renamingBusy}
                className="px-2 py-0.5 rounded bg-emerald-600 text-zinc-950 font-semibold text-[11px] hover:bg-emerald-500 disabled:opacity-60 cursor-pointer"
              >
                {renamingBusy ? "Renaming..." : "Save Path"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenamingOpen(false);
                  setRenameError("");
                }}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] hover:bg-zinc-700 cursor-pointer"
              >
                Cancel
              </button>
              {renameError && (
                <span className="text-[11px] text-rose-400">{renameError}</span>
              )}
            </form>
          ) : (
            <>
              <span className="font-mono text-zinc-500 truncate">
                {workspaceSlug}/{activeNote.relPath}
              </span>
              {onRenameNote && (
                <button
                  type="button"
                  title="Rename or move note (auto-refactors backlinks)"
                  onClick={() => {
                    setRenamePathInput(activeNote.relPath);
                    setRenameError("");
                    setRenamingOpen(true);
                  }}
                  className="p-1 text-zinc-500 hover:text-emerald-300 cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                title="Copy relative file path"
                onClick={() => {
                  navigator.clipboard?.writeText(activeNote.relPath).catch(() => {});
                  setCopiedPath(true);
                  setTimeout(() => setCopiedPath(false), 1200);
                }}
                className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
              >
                {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </>
          )}
          <span className="hidden sm:inline text-zinc-600">•</span>
          <span className="hidden sm:inline text-zinc-400">
            {activeNote.wordCount} words
          </span>
          <span className="hidden md:inline text-zinc-600">•</span>
          <span className="hidden md:inline text-[11px] text-zinc-500">
            {saving
              ? "Saving..."
              : dirty
                ? "Unsaved draft"
                : lastSavedAt
                  ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                  : "Synced"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
            {(
              [
                { id: "split", label: "Split", icon: Columns2 },
                { id: "edit", label: "Markdown", icon: FileCode2 },
                { id: "preview", label: "Preview", icon: Eye },
                { id: "graph", label: "Local Graph", icon: Network },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setViewMode(m.id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition cursor-pointer ${
                    viewMode === m.id
                      ? "bg-zinc-800 text-zinc-100 font-medium"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onSaveNow()}
            title="Save (Ctrl+S)"
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium border transition cursor-pointer ${
              dirty
                ? "bg-emerald-600 text-zinc-950 border-emerald-500 hover:bg-emerald-500"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800"
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>

          <button
            type="button"
            onClick={onAskAiAboutNote}
            title="Ask AI grounded in this note"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Ask AI</span>
          </button>

          <button
            type="button"
            onClick={onToggleFavorite}
            title="Toggle Favorite"
            className={`p-1.5 rounded-lg border cursor-pointer ${
              activeNote.isFavorite
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Star className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onTogglePin}
            title="Toggle Pin"
            className={`p-1.5 rounded-lg border cursor-pointer ${
              activeNote.isPinned
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onTrashNote}
            title="Move to Trash"
            className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-rose-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Properties / Tags + Quick Formatting Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 border-b border-zinc-800/60 bg-[#0b0b0e] text-xs shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-300">
            type: {activeNote.objectType}
          </span>
          {parsedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px]"
            >
              <Tag className="w-2.5 h-2.5" />
              {tag}
              <button
                type="button"
                onClick={() => onChangeDraft(upsertTagInMarkdown(draftContent, undefined, tag))}
                className="hover:text-white cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTagInput.trim()) return;
              onChangeDraft(upsertTagInMarkdown(draftContent, newTagInput));
              setNewTagInput("");
            }}
            className="inline-flex items-center"
          >
            <input
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder="+ tag"
              className="w-20 focus:w-28 transition-all bg-zinc-950 border border-zinc-800 rounded-md px-2 py-0.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </form>
          <button
            type="button"
            onClick={() => setPropsExpanded((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] cursor-pointer ${
              propsExpanded
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <SlidersHorizontal className="w-2.5 h-2.5" />
            Properties ({parsedProperties.length})
          </button>
        </div>

        {(viewMode === "edit" || viewMode === "split") && (
          <div className="flex items-center gap-1 text-zinc-400">
            <button
              type="button"
              title="Heading 1"
              onClick={() => insertAtCursor("# ")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Heading1 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Heading 2"
              onClick={() => insertAtCursor("## ")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Heading2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Bold"
              onClick={() => insertAtCursor("**", "**")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Code block"
              onClick={() => insertAtCursor("```\n", "\n```")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Code className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Task checkbox"
              onClick={() => insertAtCursor("- [ ] ")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Insert WikiLink"
              onClick={() => insertAtCursor("[[", "]]")}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Upload image or file attachment"
              onClick={() => fileInputRef.current?.click()}
              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="AI Inline Rewrite (Ctrl+I)"
              onClick={openInlineRewriteFromCursor}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 text-[11px] font-medium cursor-pointer ml-1"
            >
              <Wand2 className="w-3 h-3" />
              <span className="hidden xl:inline">AI Rewrite</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const embed = await onUploadAttachment(f);
                if (embed) insertAtCursor(`\n${embed}\n`);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {/* Item 8: Typed YAML Properties Grid */}
      {propsExpanded && (
        <div className="px-4 py-2.5 border-b border-zinc-800/70 bg-[#0d0d11] text-xs space-y-2 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {parsedProperties.map((prop) => {
              const kLower = prop.key.toLowerCase();
              return (
                <div
                  key={prop.key}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1"
                >
                  <span className="font-mono text-[11px] text-zinc-400 w-20 truncate shrink-0">
                    {prop.key}
                  </span>
                  {kLower === "type" ? (
                    <select
                      value={prop.value}
                      onChange={(e) =>
                        onChangeDraft(upsertFrontmatterProperty(draftContent, prop.key, e.target.value))
                      }
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                    >
                      {["note", "daily", "project", "concept", "person", "server", "research", "snippet"].map(
                        (opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ),
                      )}
                      {!["note", "daily", "project", "concept", "person", "server", "research", "snippet"].includes(prop.value) && (
                        <option value={prop.value}>{prop.value}</option>
                      )}
                    </select>
                  ) : kLower === "status" ? (
                    <select
                      value={prop.value}
                      onChange={(e) =>
                        onChangeDraft(upsertFrontmatterProperty(draftContent, prop.key, e.target.value))
                      }
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                    >
                      {["draft", "active", "review", "blocked", "done", "archived"].map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {!["draft", "active", "review", "blocked", "done", "archived"].includes(prop.value) && (
                        <option value={prop.value}>{prop.value}</option>
                      )}
                    </select>
                  ) : kLower === "date" || kLower === "due" ? (
                    <input
                      type="date"
                      value={/^\d{4}-\d{2}-\d{2}/.test(prop.value) ? prop.value.slice(0, 10) : ""}
                      onChange={(e) =>
                        onChangeDraft(upsertFrontmatterProperty(draftContent, prop.key, e.target.value))
                      }
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                    />
                  ) : (
                    <input
                      value={prop.value}
                      onChange={(e) =>
                        onChangeDraft(upsertFrontmatterProperty(draftContent, prop.key, e.target.value))
                      }
                      placeholder={kLower === "url" ? "https://..." : "value"}
                      className="flex-1 bg-transparent text-[11px] text-zinc-100 focus:outline-none"
                    />
                  )}
                  <button
                    type="button"
                    title={`Remove ${prop.key}`}
                    onClick={() =>
                      onChangeDraft(upsertFrontmatterProperty(draftContent, prop.key, null))
                    }
                    className="text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newPropKey.trim()) return;
              onChangeDraft(
                upsertFrontmatterProperty(draftContent, newPropKey.trim(), newPropVal.trim()),
              );
              setNewPropKey("");
              setNewPropVal("");
            }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <input
              value={newPropKey}
              onChange={(e) => setNewPropKey(e.target.value)}
              placeholder="property (e.g. status, due, url)"
              className="w-44 bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
            <input
              value={newPropVal}
              onChange={(e) => setNewPropVal(e.target.value)}
              placeholder="value"
              className="w-44 bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 font-medium cursor-pointer"
            >
              + Add Property
            </button>
          </form>
        </div>
      )}

      {/* Highlighted AI Citation Callout */}
      {highlightLines && (
        <div className="mx-4 mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs shrink-0">
          <div className="flex items-center justify-between text-emerald-300 font-medium mb-1">
            <span>
              AI Source Citation Highlight: L{highlightLines.start}–L{highlightLines.end}
            </span>
            <button
              type="button"
              onClick={onClearHighlight}
              className="text-emerald-300/80 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {highlightedBlock && (
            <pre className="text-[11px] font-mono text-zinc-200 whitespace-pre-wrap max-h-24 overflow-y-auto bg-zinc-950/60 p-2 rounded">
              {highlightedBlock}
            </pre>
          )}
        </div>
      )}

      {/* Main Editor / Preview / Local Graph Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {viewMode === "graph" ? (
          <div className="flex-1 min-h-0">
            <KnowledgeGraph
              graph={localGraph}
              activeNoteId={activeNote.id}
              onSelectNote={(id) => onOpenNoteById(id)}
              compact
            />
          </div>
        ) : (
          <>
            {(viewMode === "edit" || viewMode === "split") && (
              <div
                className={`relative flex flex-col min-w-0 min-h-0 bg-[#0b0b0e] ${
                  viewMode === "split" ? "w-1/2 border-r border-zinc-800/80" : "flex-1"
                }`}
              >
                {fmSplit && frontmatterFolded && (
                  <button
                    type="button"
                    onClick={() => setFrontmatterFolded(false)}
                    className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-900 text-[11px] text-zinc-400 cursor-pointer shrink-0"
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      YAML Frontmatter collapsed ({fmSplit.fmLineCount} lines) — Click to expand
                    </span>
                  </button>
                )}

                <div className="flex-1 flex min-h-0 relative overflow-hidden">
                  {/* Synchronized Line-Number & Fold Gutter */}
                  <div
                    ref={gutterRef}
                    aria-hidden="true"
                    className="cortex-editor-gutter w-12 shrink-0 bg-[#09090c] border-r border-zinc-800/70 py-4 px-1.5 overflow-hidden text-right text-[11px] text-zinc-600"
                  >
                    {editorVisibleValue.split(/\r?\n/).map((lineText, idx) => {
                      const realLineNum = lineNumberOffset + idx + 1;
                      const isActive = activeCursorLine === realLineNum;
                      const isFmStart = !frontmatterFolded && fmSplit && realLineNum === 1;
                      const isHeading = /^#{1,6}\s+/.test(lineText);
                      return (
                        <div
                          key={realLineNum}
                          style={{ height: "21.125px", lineHeight: "21.125px" }}
                          className={`flex items-center justify-end gap-0.5 pr-0.5 rounded-sm ${
                            isActive ? "bg-zinc-800/70 text-emerald-400 font-semibold" : ""
                          }`}
                        >
                          {isFmStart ? (
                            <button
                              type="button"
                              onClick={() => setFrontmatterFolded(true)}
                              title="Fold YAML frontmatter"
                              className="pointer-events-auto text-emerald-400 hover:text-emerald-300 cursor-pointer"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          ) : isHeading ? (
                            <span className="text-[9px] text-indigo-400/80 font-sans">&sect;</span>
                          ) : null}
                          <span>{realLineNum}</span>
                        </div>
                      );
                    })}
                  </div>

                  <textarea
                    ref={editorRef}
                    value={editorVisibleValue}
                    onChange={(e) => handleVisibleEditorChange(e.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    onClick={(e) => syncCursorLine(e.currentTarget)}
                    onKeyUp={(e) => syncCursorLine(e.currentTarget)}
                    onScroll={(e) => {
                      if (gutterRef.current) {
                        gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                      }
                    }}
                    onDrop={async (e) => {
                      const file = e.dataTransfer?.files?.[0];
                      if (file && !file.name.endsWith(".md")) {
                        e.preventDefault();
                        const embed = await onUploadAttachment(file);
                        if (embed) insertAtCursor(`\n${embed}\n`);
                      }
                    }}
                    spellCheck={false}
                    placeholder="Write Markdown, YAML frontmatter, #tags, [[WikiLinks]], or type / for quick blocks..."
                    className="cortex-editor-textarea flex-1 w-full resize-none bg-[#0b0b0e] py-4 px-4 sm:px-5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none overflow-y-auto whitespace-pre overflow-x-auto"
                    style={{ lineHeight: "21.125px" }}
                  />
                </div>

                {wikiSuggestions.length > 0 && (
                  <div className="absolute left-4 bottom-4 z-20 w-72 rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                      Link Note [[WikiLink]]
                    </div>
                    {wikiSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => applyWikiSuggestion(s.title)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-800/80 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="text-zinc-100 font-medium truncate">
                          {s.title}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 truncate">
                          {s.relPath}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {slashSuggestions.length > 0 && (
                  <div className="absolute left-4 bottom-4 z-20 w-64 rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                      Slash Commands
                    </div>
                    {slashSuggestions.map((s) => (
                      <button
                        key={s.cmd}
                        type="button"
                        onClick={() => applySlashCommand(s.snippet)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800/80 flex items-center justify-between cursor-pointer"
                      >
                        <span className="text-zinc-200">{s.label}</span>
                        <span className="font-mono text-[10px] text-emerald-400">
                          {s.cmd}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(viewMode === "preview" || viewMode === "split") && (
              <div
                ref={previewRef}
                className={`overflow-y-auto p-5 sm:p-7 bg-[#0d0d11] relative ${
                  viewMode === "split" ? "w-1/2" : "flex-1"
                }`}
              >
                <div
                  className="cortex-prose max-w-3xl mx-auto"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
                {hoveredWikiPreview && (
                  <div
                    style={{
                      position: "fixed",
                      left: `${hoveredWikiPreview.x}px`,
                      top: `${hoveredWikiPreview.y}px`,
                    }}
                    className="pointer-events-none z-50 w-68 rounded-xl border border-emerald-500/35 bg-zinc-950/95 p-3 shadow-2xl space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-zinc-100 truncate">
                        {hoveredWikiPreview.title}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-emerald-300 uppercase">
                        {hoveredWikiPreview.objectType}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-500 truncate">
                      {hoveredWikiPreview.relPath} • {hoveredWikiPreview.wordCount} words
                    </div>
                    {hoveredWikiPreview.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {hoveredWikiPreview.tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Connected Knowledge Inspector */}
      <div className="border-t border-zinc-800/90 bg-[#0e0e12] shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60 overflow-x-auto">
          <div className="flex items-center gap-1 text-[11px]">
            {(
              [
                { id: "backlinks", label: `Backlinks (${backlinks.length})`, icon: Link2 },
                {
                  id: "mentions",
                  label: `Unlinked Mentions (${unlinkedMentions.length})`,
                  icon: Plus,
                },
                { id: "related", label: `Related (${relatedNotes.length})`, icon: Sparkles },
                { id: "outline", label: `Outline (${headings.length})`, icon: ListTree },
                { id: "history", label: `History (${versions.length})`, icon: History },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              const open = inspectorTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setInspectorTab(open ? null : t.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition cursor-pointer shrink-0 ${
                    open
                      ? "bg-zinc-800 text-zinc-100 font-medium"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                </button>
              );
            })}
          </div>
          {inspectorTab && (
            <button
              type="button"
              onClick={() => setInspectorTab(null)}
              className="text-zinc-500 hover:text-zinc-200 p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {inspectorTab && (
          <div className="max-h-44 overflow-y-auto p-3 text-xs space-y-2">
            {inspectorTab === "backlinks" && (
              <>
                {backlinks.length === 0 ? (
                  <p className="text-zinc-500">
                    No other notes link to <code className="text-zinc-300">[[{activeNote.title}]]</code> yet.
                  </p>
                ) : (
                  backlinks.map((bl) => (
                    <div
                      key={bl.id}
                      onClick={() => onOpenNoteById(bl.source_note_id, bl.line_number)}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 hover:border-emerald-500/40 px-3 py-2 cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-zinc-200 font-medium">
                        <span>{bl.source_title}</span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {bl.source_path}#L{bl.line_number}
                        </span>
                      </div>
                      <p className="text-zinc-400 mt-1 line-clamp-2">{bl.context_snippet}</p>
                    </div>
                  ))
                )}
              </>
            )}

            {inspectorTab === "mentions" && (
              <>
                {unlinkedMentions.length === 0 ? (
                  <p className="text-zinc-500">No unlinked mentions found.</p>
                ) : (
                  unlinkedMentions.map((m, idx) => (
                    <div
                      key={`${m.sourceNoteId}-${m.lineNumber}-${idx}`}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <div
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => onOpenNoteById(m.sourceNoteId, m.lineNumber)}
                      >
                        <div className="text-zinc-200 font-medium">
                          {m.sourceTitle}{" "}
                          <span className="font-mono text-[10px] text-zinc-500">
                            L{m.lineNumber}
                          </span>
                        </div>
                        <p className="text-zinc-400 truncate">{m.snippet}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onLinkMention(m)}
                        className="shrink-0 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                      >
                        Link [[{activeNote.title}]]
                      </button>
                    </div>
                  ))
                )}
              </>
            )}

            {inspectorTab === "related" && (
              <>
                {relatedNotes.length === 0 ? (
                  <p className="text-zinc-500">No semantically related notes indexed yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {relatedNotes.map((r) => (
                      <button
                        key={r.noteId}
                        type="button"
                        onClick={() => onOpenNoteById(r.noteId)}
                        className="text-left rounded-lg border border-zinc-800/80 bg-zinc-950/70 hover:border-blue-500/40 px-3 py-2 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-zinc-200 truncate">
                            {r.title}
                          </span>
                          <span className="text-[10px] text-blue-400 shrink-0">
                            {Math.round(r.score * 100)}%
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                          {r.relPath}
                        </div>
                        {r.sharedConcepts && r.sharedConcepts.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {r.sharedConcepts.slice(0, 3).map((concept) => (
                              <span
                                key={concept}
                                className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[9px]"
                              >
                                {concept}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {inspectorTab === "outline" && (
              <>
                {headings.length === 0 ? (
                  <p className="text-zinc-500">No headings in this note.</p>
                ) : (
                  <div className="space-y-1">
                    {headings.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => onOpenNoteById(activeNote.id, h.start_line)}
                        style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                        className="w-full text-left py-1 rounded hover:bg-zinc-900 text-zinc-300 flex items-center justify-between cursor-pointer"
                      >
                        <span>{h.text}</span>
                        <span className="text-[10px] font-mono text-zinc-600 pr-2">
                          L{h.start_line}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {inspectorTab === "history" && (
              <>
                {versions.length === 0 ? (
                  <p className="text-zinc-500">
                    No previous snapshots yet. Snapshots are created automatically on edits and AI updates.
                  </p>
                ) : (
                  versions.map((v) => (
                    <div
                      key={v.id}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-zinc-200 font-medium">
                          {v.summary}{" "}
                          <span className="text-[10px] text-zinc-500">
                            by {v.created_by} • {new Date(v.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500">
                          SHA {v.sha256.slice(0, 12)} • {v.size_bytes} bytes
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedVersion(v)}
                          className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white cursor-pointer"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => onRestoreVersion(v.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Snapshot Viewer Modal */}
      {selectedVersion && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setSelectedVersion(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-zinc-100">
                  Snapshot: {selectedVersion.summary}
                </h3>
                <p className="text-[11px] text-zinc-400">
                  {new Date(selectedVersion.created_at).toLocaleString()} •{" "}
                  {selectedVersion.created_by}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVersion(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="max-h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 whitespace-pre-wrap">
              {selectedVersion.content}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedVersion(null)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-300 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = selectedVersion.id;
                  setSelectedVersion(null);
                  await onRestoreVersion(id);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-zinc-950 font-semibold text-xs cursor-pointer"
              >
                Restore This Version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Conflict Resolution Modal (Interactive Hunk-by-Hunk 3-Way Merge) */}
      {conflict && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-amber-500/40 bg-[#111114] p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-zinc-100">
                  3-Way Conflict Merge — {conflict.title}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  The file <code className="text-zinc-200">{conflict.relPath}</code> changed on
                  the server (SHA <code className="text-zinc-300">{conflict.serverSha256.slice(0, 10)}</code>) while you had unsaved edits. Pick Mine, Server, or Both per differing block.
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {mergeHunks.map((h) => {
                if (h.same) {
                  return (
                    <div
                      key={h.index}
                      className="rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-2 font-mono text-[11px] text-zinc-500 whitespace-pre-wrap line-clamp-2"
                    >
                      {h.localText}
                    </div>
                  );
                }
                const choice = hunkChoices[h.index] || "both";
                return (
                  <div
                    key={h.index}
                    className="rounded-xl border border-amber-500/35 bg-zinc-950/85 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-amber-300">
                        Conflict Hunk #{h.index + 1}
                      </span>
                      <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[10px]">
                        {(
                          [
                            ["local", "Keep Mine"],
                            ["server", "Take Server"],
                            ["both", "Keep Both"],
                          ] as const
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() =>
                              setHunkChoices((prev) => ({ ...prev, [h.index]: k }))
                            }
                            className={`px-2 py-0.5 rounded cursor-pointer ${
                              choice === k
                                ? "bg-amber-500 text-zinc-950 font-semibold"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2">
                        <div className="text-[10px] font-semibold text-emerald-400 mb-1">
                          Your Draft
                        </div>
                        <pre className="font-mono text-[11px] text-zinc-200 whitespace-pre-wrap max-h-36 overflow-y-auto">
                          {h.localText || "(removed)"}
                        </pre>
                      </div>
                      <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-2">
                        <div className="text-[10px] font-semibold text-blue-400 mb-1">
                          Server Copy
                        </div>
                        <pre className="font-mono text-[11px] text-zinc-200 whitespace-pre-wrap max-h-36 overflow-y-auto">
                          {h.serverText || "(removed)"}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => onResolveConflict("server")}
                className="px-3.5 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-blue-300 text-xs font-medium hover:bg-blue-500/20 cursor-pointer"
              >
                Accept Full Server Copy
              </button>
              <button
                type="button"
                onClick={() => onResolveConflict("merge", buildHunkMergedText())}
                className="px-3.5 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/25 cursor-pointer"
              >
                Apply Selected Hunk Merge
              </button>
              <button
                type="button"
                onClick={() => onResolveConflict("local")}
                className="px-3.5 py-2 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold hover:bg-amber-400 cursor-pointer"
              >
                Overwrite Server With Mine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item 3: AI Inline Rewrite (Ctrl+I) Popover Modal */}
      {rewriteOpen && rewriteRange && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-blue-500/40 bg-[#111114] p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-zinc-100">
                  AI Inline Rewrite (Ctrl+I)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRewriteOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-medium text-zinc-400">
                Selected Markdown ({rewriteRange.selectedText.length} chars)
              </div>
              <pre className="max-h-28 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
                {rewriteRange.selectedText || "(empty selection)"}
              </pre>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {REWRITE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => runInlineRewrite(preset.instruction)}
                  disabled={rewriteLoading}
                  className="px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900 hover:border-blue-500/50 hover:text-blue-300 text-[11px] text-zinc-300 cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runInlineRewrite();
              }}
              className="flex gap-2"
            >
              <input
                value={rewriteInstruction}
                onChange={(e) => setRewriteInstruction(e.target.value)}
                placeholder="Describe how to transform this selection..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={rewriteLoading || !rewriteRange.selectedText.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {rewriteLoading ? "Rewriting..." : "Preview Diff"}
              </button>
            </form>

            {rewriteError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {rewriteError}
              </div>
            )}

            {rewriteResult && (
              <div className="space-y-2">
                {rewriteResult.fallbackWarning && (
                  <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                    {rewriteResult.fallbackWarning}
                  </div>
                )}
                <div className="text-[11px] font-medium text-zinc-400">
                  Unified Diff Preview
                </div>
                <pre className="max-h-52 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap">
                  {rewriteResult.diffPreview.split("\n").map((line, idx) => {
                    const cls = line.startsWith("+") && !line.startsWith("+++")
                      ? "text-emerald-300 bg-emerald-500/10 block px-1"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "text-rose-300 bg-rose-500/10 block px-1"
                        : "text-zinc-500 block px-1";
                    return (
                      <span key={idx} className={cls}>
                        {line}
                      </span>
                    );
                  })}
                </pre>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRewriteOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={applyInlineRewrite}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold text-xs cursor-pointer"
                  >
                    Accept Replacement
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
