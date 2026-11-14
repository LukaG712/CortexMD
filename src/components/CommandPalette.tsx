"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  BookmarkPlus,
  CalendarDays,
  FilePlus2,
  FileText,
  Folder,
  Kanban,
  Network,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { SearchHit } from "@/lib/types";
import { searchOfflineNotes } from "@/lib/offline-db";

interface CommandPaletteProps {
  open: boolean;
  workspaceSlug: string;
  initialQuery?: string;
  availableTags?: string[];
  availableFolders?: string[];
  onClose: () => void;
  onOpenNote: (noteId: string, workspaceSlug?: string, line?: number) => void;
  onAction: (
    action: "new-note" | "daily-note" | "graph" | "kanban" | "import" | "ai-chat",
  ) => void;
  onSaveSearch?: (name: string, query: string) => Promise<void>;
}

export function CommandPalette({
  open,
  workspaceSlug,
  initialQuery = "",
  availableTags = [],
  availableFolders = [],
  onClose,
  onOpenNote,
  onAction,
  onSaveSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<"hybrid" | "fts" | "semantic">("hybrid");
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [objectTypeFilter, setObjectTypeFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);

  useEffect(() => {
    if (open && initialQuery !== undefined) {
      setQuery(initialQuery);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const runOffline = async () => {
        const ws = allWorkspaces ? "all" : workspaceSlug;
        let offline = await searchOfflineNotes(query, ws);
        if (objectTypeFilter) {
          offline = offline.filter((h) => h.objectType === objectTypeFilter);
        }
        if (tagFilter) {
          offline = offline.filter((h) => h.tags.includes(tagFilter));
        }
        if (folderFilter) {
          offline = offline.filter(
            (h) => h.folder === folderFilter || h.folder.startsWith(`${folderFilter}/`),
          );
        }
        if (!cancelled) setResults(offline);
      };

      try {
        const ws = allWorkspaces ? "all" : workspaceSlug;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          await runOffline();
          return;
        }
        const params = new URLSearchParams({
          q: query,
          workspaceSlug: ws,
          mode,
          limit: "18",
        });
        if (objectTypeFilter) params.set("objectType", objectTypeFilter);
        if (tagFilter) params.set("tag", tagFilter);
        if (folderFilter) params.set("folder", folderFilter);

        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) {
          await runOffline();
          return;
        }
        const data = await res.json();
        if (!cancelled) setResults(data.results || []);
      } catch {
        await runOffline();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 130);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, workspaceSlug, mode, allWorkspaces, objectTypeFilter, tagFilter, folderFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === "ArrowUp" && results.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === "Enter" && results[selectedIndex]) {
        const activeHit = results[selectedIndex];
        e.preventDefault();
        onOpenNote(activeHit.noteId, activeHit.workspaceSlug, activeHit.startLine);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, selectedIndex, onClose, onOpenNote]);

  if (!open) return null;

  const hasFacetFilters = Boolean(objectTypeFilter || tagFilter || folderFilter || allWorkspaces);
  const previewHit = results[selectedIndex] || null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[8vh] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-zinc-800 apple-glass shadow-2xl overflow-hidden apple-spring"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-emerald-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, headings, tags, or semantic concepts... (Up/Down + Enter)"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          {onSaveSearch && query.trim() && (
            <button
              type="button"
              disabled={savingSearch}
              onClick={async () => {
                const trimmed = query.trim();
                if (!trimmed) return;
                setSavingSearch(true);
                try {
                  await onSaveSearch(trimmed.slice(0, 40), trimmed);
                } finally {
                  setSavingSearch(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-[11px] text-emerald-300 framer-press cursor-pointer"
            >
              <BookmarkPlus className="w-3 h-3" />
              {savingSearch ? "Saving..." : "Save Search"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Airbnb-Inspired Multi-Facet Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Search Engine Pills */}
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {(["hybrid", "fts", "semantic"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2 py-0.5 rounded-md font-medium capitalize framer-press cursor-pointer ${
                    mode === m
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {m === "fts" ? "Full-Text" : m}
                </button>
              ))}
            </div>

            {/* Object Type Pills */}
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {(
                [
                  { id: "", label: "All" },
                  { id: "note", label: "Notes" },
                  { id: "daily", label: "Daily" },
                  { id: "source", label: "Sources" },
                ] as const
              ).map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setObjectTypeFilter(t.id)}
                  className={`px-2 py-0.5 rounded-md font-medium framer-press cursor-pointer ${
                    objectTypeFilter === t.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Folder Dropdown */}
            {availableFolders.length > 0 && (
              <label className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300">
                <Folder className="w-3 h-3 text-zinc-500" />
                <select
                  aria-label="Filter by folder"
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="bg-transparent text-[11px] focus:outline-none cursor-pointer max-w-[115px]"
                >
                  <option value="">All folders</option>
                  {availableFolders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Tag Dropdown */}
            {availableTags.length > 0 && (
              <label className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300">
                <Tag className="w-3 h-3 text-emerald-400" />
                <select
                  aria-label="Filter by tag"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="bg-transparent text-[11px] focus:outline-none cursor-pointer max-w-[115px]"
                >
                  <option value="">Any tag</option>
                  {availableTags.slice(0, 30).map((t) => (
                    <option key={t} value={t}>
                      #{t}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {hasFacetFilters && (
              <button
                type="button"
                onClick={() => {
                  setObjectTypeFilter("");
                  setTagFilter("");
                  setFolderFilter("");
                  setAllWorkspaces(false);
                }}
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
            <label className="inline-flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={allWorkspaces}
                onChange={(e) => setAllWorkspaces(e.target.checked)}
                className="accent-emerald-500"
              />
              All vaults
            </label>
          </div>
        </div>

        {/* Quick Actions when query & filters are empty */}
        {!query && !objectTypeFilter && !tagFilter && !folderFilter && (
          <div className="p-3 border-b border-zinc-800/70 grid grid-cols-2 sm:grid-cols-3 gap-2 bg-zinc-950/30">
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("new-note");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" /> New Note / Template
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("daily-note");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <CalendarDays className="w-3.5 h-3.5 text-amber-400" /> Today&apos;s Daily Note
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("graph");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <Network className="w-3.5 h-3.5 text-blue-400" /> Open Global Graph
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("kanban");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <Kanban className="w-3.5 h-3.5 text-teal-400" /> Tasks & Kanban
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("import");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-purple-400" /> Import Obsidian Vault
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction("ai-chat");
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 framer-press cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Focus AI Studio
            </button>
          </div>
        )}

        {/* Split Results + Live Preview Body */}
        <div className="grid grid-cols-1 md:grid-cols-5 max-h-[54vh]">
          <div className="md:col-span-3 overflow-y-auto divide-y divide-zinc-800/60 border-r border-zinc-800/70">
            {loading && results.length === 0 && (
              <div className="p-6 text-center text-xs text-zinc-500">
                Searching FTS5 + semantic vectors...
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="p-6 text-center text-xs text-zinc-500">
                No notes matched {query ? `"${query}"` : "active filters"}.
              </div>
            )}

            {results.map((hit, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={`${hit.workspaceSlug}:${hit.noteId}:${idx}`}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onOpenNote(hit.noteId, hit.workspaceSlug, hit.startLine);
                    onClose();
                  }}
                  className={`w-full text-left px-4 py-3 transition flex flex-col gap-1 cursor-pointer ${
                    active ? "bg-emerald-500/10" : "hover:bg-zinc-900/80"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-emerald-400" : "text-zinc-500"
                        }`}
                      />
                      <span className="font-medium text-sm text-zinc-100 truncate">
                        {hit.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                        {hit.workspaceSlug}
                      </span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 tabular-nums shrink-0">
                      {hit.matchType}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span className="font-mono truncate">{hit.relPath}</span>
                    {hit.startLine && (
                      <span className="tabular-nums shrink-0">L{hit.startLine}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Airbnb-style Live Result Preview Inspector */}
          <div className="hidden md:flex md:col-span-2 flex-col justify-between p-4 bg-zinc-950/40 overflow-y-auto">
            {previewHit ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="specimen-label text-zinc-500">
                    Result Preview • {previewHit.objectType}
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {previewHit.title}
                  </h3>
                  <div className="text-[11px] font-mono text-zinc-500 break-all">
                    {previewHit.workspaceSlug}/{previewHit.relPath}
                    {previewHit.startLine ? `#L${previewHit.startLine}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300 tabular-nums">
                    Score {previewHit.score}
                  </span>
                  {previewHit.folder && (
                    <span className="text-[10px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
                      {previewHit.folder}
                    </span>
                  )}
                  {previewHit.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-zinc-300"
                    >
                      #{t}
                    </span>
                  ))}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {previewHit.snippet
                    ? previewHit.snippet.replace(/<\/?mark>/g, "")
                    : "No snippet preview."}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenNote(
                      previewHit.noteId,
                      previewHit.workspaceSlug,
                      previewHit.startLine,
                    );
                    onClose();
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold py-2 text-xs framer-press cursor-pointer"
                >
                  Open Note <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-center text-xs text-zinc-500 px-4">
                Hover or use arrow keys on a result to inspect its excerpt and metadata.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
