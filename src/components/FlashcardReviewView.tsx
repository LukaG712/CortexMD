"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  Layers,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { FlashcardItem } from "@/lib/types";

interface FlashcardReviewViewProps {
  workspaceSlug: string;
  csrfToken: string;
  onOpenNote: (noteId: string, line?: number) => void;
  onNotify: (msg: string) => void;
}

export function FlashcardReviewView({
  workspaceSlug,
  csrfToken,
  onOpenNote,
  onNotify,
}: FlashcardReviewViewProps) {
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [dueOnly, setDueOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/flashcards?workspaceSlug=${encodeURIComponent(workspaceSlug)}&dueOnly=${dueOnly}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setCards(data.cards || []);
      setDueCount(data.dueCount || 0);
      setTotalCount(data.totalCount || 0);
      setRevealed(false);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, dueOnly]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const current = cards[0] || null;

  async function handleRate(rating: 1 | 2 | 3 | 4) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ cardId: current.id, rating }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to record review");
        return;
      }
      const nextInterval = data.card?.intervalDays ?? 0;
      onNotify(
        nextInterval >= 1
          ? `Scheduled next review in ${nextInterval}d`
          : "Re-queued card for short review",
      );
      await loadCards();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] p-4 md:p-6 overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Brain className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                Active Recall Flashcards (SM-2)
              </h2>
              <p className="text-xs text-zinc-400">
                {dueCount} due now • {totalCount} total indexed in{" "}
                <span className="font-mono text-zinc-300">{workspaceSlug}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDueOnly(true)}
                className={`px-2.5 py-1 rounded-md cursor-pointer ${
                  dueOnly
                    ? "bg-emerald-500/20 text-emerald-300 font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Due ({dueCount})
              </button>
              <button
                type="button"
                onClick={() => setDueOnly(false)}
                className={`px-2.5 py-1 rounded-md cursor-pointer ${
                  !dueOnly
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All ({totalCount})
              </button>
            </div>
            <button
              type="button"
              title="Refresh Cards"
              onClick={loadCards}
              className="p-2 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-10 text-center text-sm text-zinc-400">
            Scanning vault notes for flashcards...
          </div>
        ) : !current ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#101015] p-8 text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-100">
                {totalCount > 0
                  ? "All caught up for now!"
                  : "No flashcards indexed in this vault yet"}
              </h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Add flashcards inside any Markdown note using{" "}
                <code className="text-emerald-300">Term :: Answer</code>,{" "}
                <code className="text-emerald-300">Q:</code> /{" "}
                <code className="text-emerald-300">A:</code> lines, or headings tagged{" "}
                <code className="text-emerald-300">#card</code>.
              </p>
            </div>
            {totalCount > 0 && dueOnly && (
              <button
                type="button"
                onClick={() => setDueOnly(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                Practice All {totalCount} Cards Anyway
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-[#111116] p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 border-b border-zinc-800/80 pb-3">
              <button
                type="button"
                onClick={() => onOpenNote(current.noteId, current.lineNumber)}
                className="inline-flex items-center gap-1.5 font-mono text-emerald-300 hover:underline cursor-pointer"
              >
                <span>
                  {current.relPath}:{current.lineNumber}
                </span>
                <ExternalLink className="w-3 h-3" />
              </button>
              <span>
                Interval {current.intervalDays}d • EF {current.easeFactor.toFixed(2)} • Reps{" "}
                {current.repetitions}
              </span>
            </div>

            <div className="min-h-[120px] flex flex-col justify-center space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                  Prompt
                </div>
                <div className="text-lg font-medium text-zinc-100 leading-relaxed whitespace-pre-wrap">
                  {current.front}
                </div>
              </div>

              {revealed && (
                <div className="pt-4 border-t border-zinc-800/80">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">
                    Answer
                  </div>
                  <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {current.back}
                  </div>
                </div>
              )}
            </div>

            {!revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold py-2.5 text-sm cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
                Reveal Answer
              </button>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRate(1)}
                  className="rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 py-2 text-xs font-semibold text-rose-300 cursor-pointer"
                >
                  1. Again (1m)
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRate(2)}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 py-2 text-xs font-semibold text-amber-300 cursor-pointer"
                >
                  2. Hard
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRate(3)}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 py-2 text-xs font-semibold text-emerald-300 cursor-pointer"
                >
                  3. Good
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRate(4)}
                  className="rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 py-2 text-xs font-semibold text-blue-300 cursor-pointer"
                >
                  4. Easy
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
