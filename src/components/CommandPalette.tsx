"use client";

import { searchOfflineNotes } from "@/lib/offline-db";

import React, { useEffect, useState } from "react";
import {
  BookmarkPlus,
  CalendarDays,
  FilePlus2,
  Kanban,
  Network,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { SearchHit } from "@/lib/types";

interface CommandPaletteProps {
  open: boolean;
  workspaceSlug: string;
  initialQuery?: string;
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
  onClose,
  onOpenNote,
  onAction,
  onSaveSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<"hybrid" | "fts" | "semantic">("hybrid");
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);

  useEffect(() => {
    if (open && initialQuery !== undefined) {
      setQuery(initialQuery);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const ws = allWorkspaces ? "all" : workspaceSlug;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const offline = await searchOfflineNotes(query, ws);
          if (!cancelled) setResults(offline);
          return;
        }
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&workspaceSlug=${encodeURIComponent(ws)}&mode=${mode}&limit=16`,
        );
        if (!res.ok) {
          const offline = await searchOfflineNotes(query, ws);
          if (!cancelled) setResults(offline);
          return;
        }
        const data = await res.json();
        if (!cancelled) setResults(data.results || []);
      } catch {
        const ws = allWorkspaces ? "all" : workspaceSlug;
        const offline = await searchOfflineNotes(query, ws);
        if (!cancelled) setResults(offline);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 140);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, workspaceSlug, mode, allWorkspaces]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-[10vh] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-[#111114] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-emerald-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, headings, tags, or semantic concepts..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 text-[11px]">
          <div className="flex items-center gap-1">
            {(["hybrid", "fts", "semantic"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded font-medium capitalize cursor-pointer ${
                  mode === m
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m === "fts" ? "Full-Text" : m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
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
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-0.5 text-[11px] text-emerald-300 cursor-pointer"
              >
                <BookmarkPlus className="w-3 h-3" />
                {savingSearch ? "Saving..." : "Save Search"}
              </button>
            )}
            <label className="inline-flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={allWorkspaces}
                onChange={(e) => setAllWorkspaces(e.target.checked)}
                className="accent-emerald-500"
              />
              Search across all vaults
            </label>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto divide-y divide-zinc-800/60">
          {!query && (
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("new-note");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" /> New Note / Template
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("daily-note");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <CalendarDays className="w-3.5 h-3.5 text-amber-400" /> Today&apos;s Daily Note
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("graph");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <Network className="w-3.5 h-3.5 text-blue-400" /> Open Global Graph
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("kanban");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <Kanban className="w-3.5 h-3.5 text-teal-400" /> Tasks & Kanban
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("import");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-purple-400" /> Import Obsidian Vault
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAction("ai-chat");
                }}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Focus AI Studio
              </button>
            </div>
          )}

          {loading && results.length === 0 && (
            <div className="p-6 text-center text-xs text-zinc-500">
              Searching FTS5 + semantic vectors...
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="p-6 text-center text-xs text-zinc-500">
              No notes matched &quot;{query}&quot;.
            </div>
          )}

          {results.map((hit) => (
            <button
              key={hit.noteId}
              type="button"
              onClick={() => {
                onOpenNote(hit.noteId, hit.workspaceSlug, hit.startLine);
                onClose();
              }}
              className="w-full text-left px-4 py-3 hover:bg-zinc-900/80 transition flex flex-col gap-1 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm text-zinc-100 truncate">
                    {hit.title}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {hit.workspaceSlug}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {hit.matchType}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-zinc-500 truncate max-w-[40%]">
                  {hit.relPath}
                </span>
              </div>
              {hit.snippet && (
                <p className="text-xs text-zinc-400 line-clamp-2">
                  {hit.snippet.replace(/<\/?mark>/g, "")}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
