"use client";

import React, { useState } from "react";
import {
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  Circle,
  FilePlus2,
  Flame,
  Network,
  Pin,
  Plus,
  Sparkles,
  Star,
} from "lucide-react";
import { GraphData, NoteSummary, TaskItem } from "@/lib/types";

interface VaultHomeDashboardProps {
  workspaceName: string;
  workspaceSlug: string;
  notes: NoteSummary[];
  tasks: TaskItem[];
  graph: GraphData;
  conversationsCount: number;
  streakDays: number;
  csrfToken: string;
  onOpenNote: (noteId: string) => void;
  onCreateNote: () => void;
  onOpenDaily: () => void;
  onOpenView: (view: "graph" | "kanban" | "canvas" | "calendar" | "cards") => void;
  onOpenAi: () => void;
  onCaptured: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function VaultHomeDashboard({
  workspaceName,
  workspaceSlug,
  notes,
  tasks,
  graph,
  conversationsCount,
  streakDays,
  csrfToken,
  onOpenNote,
  onCreateNote,
  onOpenDaily,
  onOpenView,
  onOpenAi,
  onCaptured,
  onNotify,
}: VaultHomeDashboardProps) {
  const [captureInput, setCaptureInput] = useState("");
  const [capturing, setCapturing] = useState(false);

  const activeNotes = notes.filter((n) => !n.isTrashed);
  const pinnedOrStarred = activeNotes
    .filter((n) => n.isPinned || n.isFavorite)
    .slice(0, 6);
  const recentNotes = [...activeNotes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);
  const openTasks = tasks.filter((t) => !t.completed).slice(0, 6);
  const totalWords = activeNotes.reduce((sum, n) => sum + (n.wordCount || 0), 0);

  // Duolingo-inspired 5-step interactive onboarding quest driven by real vault telemetry
  const quests = [
    {
      id: "first-note",
      label: "Create or import a Markdown note",
      done: activeNotes.length >= 1,
      actionLabel: "New Note",
      onAction: onCreateNote,
    },
    {
      id: "wikilink",
      label: "Connect ideas using [[WikiLinks]]",
      done: graph.edges.length >= 1,
      actionLabel: "Open Graph",
      onAction: () => onOpenView("graph"),
    },
    {
      id: "daily",
      label: "Open or write today's Daily Note",
      done: activeNotes.some(
        (n) => n.objectType === "daily" || n.relPath.startsWith("journals/"),
      ),
      actionLabel: "Daily Note",
      onAction: onOpenDaily,
    },
    {
      id: "tasks",
      label: "Track tasks or flashcards in a vault",
      done: tasks.length >= 1,
      actionLabel: "Tasks Board",
      onAction: () => onOpenView("kanban"),
    },
    {
      id: "ai-chat",
      label: "Query your knowledge base in AI Studio",
      done: conversationsCount >= 1,
      actionLabel: "Ask AI",
      onAction: onOpenAi,
    },
  ];
  const completedCount = quests.filter((q) => q.done).length;
  const questPct = Math.round((completedCount / quests.length) * 100);
  const ringCircumference = 2 * Math.PI * 18;
  const ringOffset = ringCircumference * (1 - completedCount / quests.length);

  async function handleQuickCapture(e: React.FormEvent) {
    e.preventDefault();
    const text = captureInput.trim();
    if (!text) return;
    setCapturing(true);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          workspaceSlug,
          text,
          target: "inbox",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify(err.error || "Quick capture failed");
        return;
      }
      setCaptureInput("");
      await onCaptured();
      onNotify("Captured into Inbox/Quick Captures.md");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#09090b] p-5 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Aesop Specimen Header + Actions */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1.5">
            <div className="specimen-label text-zinc-500">
              01 // Vault Home Dashboard • {workspaceSlug}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-50">
              {workspaceName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 tabular-nums">
              <Flame className="w-3.5 h-3.5" />
              {streakDays}d Streak
            </div>
            <button
              type="button"
              onClick={onCreateNote}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold px-3 py-1.5 text-xs framer-press cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" /> New Note
            </button>
            <button
              type="button"
              onClick={onOpenDaily}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 px-3 py-1.5 text-xs framer-press cursor-pointer"
            >
              <CalendarDays className="w-3.5 h-3.5 text-amber-400" /> Today&apos;s Note
            </button>
          </div>
        </div>

        {/* Notion KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4 space-y-1">
            <div className="specimen-label text-zinc-500">Notes</div>
            <div className="text-2xl font-semibold text-zinc-100 tabular-nums">
              {activeNotes.length}
            </div>
            <div className="text-[11px] text-zinc-500">Plain .md files on disk</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4 space-y-1">
            <div className="specimen-label text-zinc-500">Corpus Size</div>
            <div className="text-2xl font-semibold text-zinc-100 tabular-nums">
              {totalWords.toLocaleString()}
            </div>
            <div className="text-[11px] text-zinc-500">Indexed words</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenView("graph")}
            className="text-left rounded-xl border border-zinc-800 bg-[#111114] hover:border-blue-500/40 p-4 space-y-1 framer-press cursor-pointer"
          >
            <div className="specimen-label text-zinc-500">Graph Links</div>
            <div className="text-2xl font-semibold text-blue-300 tabular-nums">
              {graph.edges.length}
            </div>
            <div className="text-[11px] text-zinc-500">
              Click to inspect network
            </div>
          </button>
          <button
            type="button"
            onClick={() => onOpenView("cards")}
            className="text-left rounded-xl border border-zinc-800 bg-[#111114] hover:border-emerald-500/40 p-4 space-y-1 framer-press cursor-pointer"
          >
            <div className="specimen-label text-zinc-500">Active Recall</div>
            <div className="text-2xl font-semibold text-emerald-300 tabular-nums flex items-center gap-2">
              <Brain className="w-5 h-5" />
              <span>SM-2</span>
            </div>
            <div className="text-[11px] text-zinc-500">
              {openTasks.length} open task(s) in Kanban
            </div>
          </button>
        </div>

        {/* Notion Quick Capture Bar */}
        <form
          onSubmit={handleQuickCapture}
          className="rounded-xl border border-zinc-800 bg-[#111114] p-3 flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />
          <input
            value={captureInput}
            onChange={(e) => setCaptureInput(e.target.value)}
            placeholder="Quick capture a thought, command, or bookmark into Inbox/Quick Captures.md..."
            className="flex-1 bg-transparent text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={capturing || !captureInput.trim()}
            className="rounded-lg bg-zinc-800 hover:bg-emerald-600 hover:text-zinc-950 disabled:opacity-40 text-zinc-200 px-3 py-1.5 text-xs font-medium framer-press cursor-pointer"
          >
            {capturing ? "Saving..." : "Capture"}
          </button>
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Duolingo Onboarding Quest */}
          <div className="lg:col-span-5 rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="specimen-label text-emerald-400">
                  02 // Second-Brain Quest
                </div>
                <h2 className="text-base font-semibold text-zinc-100 mt-0.5">
                  Vault Setup &amp; Mastery
                </h2>
                <p className="text-xs text-zinc-400 tabular-nums">
                  {completedCount}/{quests.length} complete • {completedCount * 20} XP
                </p>
              </div>
              <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    className="text-zinc-800"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    strokeLinecap="round"
                    className="text-emerald-400 apple-spring"
                  />
                </svg>
                <span className="absolute text-[10px] font-semibold text-zinc-200 tabular-nums">
                  {questPct}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {quests.map((q) => (
                <div
                  key={q.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                    q.done
                      ? "border-emerald-500/25 bg-emerald-500/5 text-zinc-300"
                      : "border-zinc-800 bg-zinc-950/60 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {q.done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-zinc-600 shrink-0" />
                    )}
                    <span className={q.done ? "line-through text-zinc-500 truncate" : "truncate"}>
                      {q.label}
                    </span>
                  </div>
                  {!q.done && (
                    <button
                      type="button"
                      onClick={q.onAction}
                      className="shrink-0 text-[11px] font-medium text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 cursor-pointer"
                    >
                      {q.actionLabel} <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notion Pinned + Recent Notes & Tasks */}
          <div className="lg:col-span-7 space-y-5">
            {pinnedOrStarred.length > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-3">
                <div className="specimen-label text-zinc-500">
                  03 // Pinned &amp; Starred
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {pinnedOrStarred.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onOpenNote(n.id)}
                      className="text-left rounded-xl border border-zinc-800 bg-zinc-950/70 hover:border-emerald-500/40 px-3 py-2.5 framer-press cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-100 truncate">
                          {n.title}
                        </span>
                        {n.isPinned ? (
                          <Pin className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : (
                          <Star className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-500 truncate mt-1">
                        {n.relPath}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-zinc-800 bg-[#111114] p-4 space-y-3">
                <div className="specimen-label text-zinc-500">
                  04 // Recently Edited
                </div>
                <div className="space-y-1.5">
                  {recentNotes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onOpenNote(n.id)}
                      className="w-full text-left flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900 text-xs framer-press cursor-pointer"
                    >
                      <span className="truncate text-zinc-200">{n.title}</span>
                      <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                        {n.wordCount}w
                      </span>
                    </button>
                  ))}
                  {recentNotes.length === 0 && (
                    <div className="text-xs text-zinc-500">No notes yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#111114] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="specimen-label text-zinc-500">
                    05 // Open Tasks
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenView("kanban")}
                    className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                  >
                    Board
                  </button>
                </div>
                <div className="space-y-1.5">
                  {openTasks.map((t, i) => (
                    <button
                      key={`${t.noteId}:${t.lineNumber}:${i}`}
                      type="button"
                      onClick={() => onOpenNote(t.noteId)}
                      className="w-full text-left flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900 text-xs framer-press cursor-pointer"
                    >
                      <span className="truncate text-zinc-200">{t.text}</span>
                      {t.priority && (
                        <span className="text-[10px] font-mono text-amber-300 shrink-0">
                          [{t.priority}]
                        </span>
                      )}
                    </button>
                  ))}
                  {openTasks.length === 0 && (
                    <div className="text-xs text-zinc-500 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      All caught up! Add `- [ ] Task` in any note.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
