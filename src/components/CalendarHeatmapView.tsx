"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Flame, Plus } from "lucide-react";
import { NoteSummary, TaskItem } from "@/lib/types";

interface CalendarHeatmapViewProps {
  workspaceSlug: string;
  notes: NoteSummary[];
  tasks: TaskItem[];
  onOpenNoteById: (noteId: string) => void;
  onOpenDailyForDate: (isoDate: string) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarHeatmapView({
  workspaceSlug,
  notes,
  tasks,
  onOpenNoteById,
  onOpenDailyForDate,
}: CalendarHeatmapViewProps) {
  const now = new Date();
  const [cursorMonth, setCursorMonth] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );

  // Build per-date index from note journals, created/updated dates & frontmatter date/due
  const activityByDate = useMemo(() => {
    const map = new Map<
      string,
      { notes: NoteSummary[]; dueNotes: NoteSummary[]; activityScore: number }
    >();

    const ensure = (iso: string) => {
      let item = map.get(iso);
      if (!item) {
        item = { notes: [], dueNotes: [], activityScore: 0 };
        map.set(iso, item);
      }
      return item;
    };

    for (const n of notes) {
      const updatedIso = new Date(n.updatedAt).toISOString().slice(0, 10);
      const bucket = ensure(updatedIso);
      bucket.activityScore += 1;
      if (!bucket.notes.some((x) => x.id === n.id)) bucket.notes.push(n);

      const journalMatch = /(\d{4}-\d{2}-\d{2})\.md$/i.exec(n.relPath);
      if (journalMatch) {
        const jb = ensure(journalMatch[1]);
        jb.activityScore += 2;
        if (!jb.notes.some((x) => x.id === n.id)) jb.notes.push(n);
      }

      const fmDate =
        typeof n.frontmatter?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(n.frontmatter.date)
          ? n.frontmatter.date.slice(0, 10)
          : null;
      if (fmDate) {
        const fb = ensure(fmDate);
        fb.activityScore += 1;
        if (!fb.notes.some((x) => x.id === n.id)) fb.notes.push(n);
      }

      const fmDue =
        typeof n.frontmatter?.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(n.frontmatter.due)
          ? n.frontmatter.due.slice(0, 10)
          : null;
      if (fmDue) {
        const db = ensure(fmDue);
        if (!db.dueNotes.some((x) => x.id === n.id)) db.dueNotes.push(n);
      }
    }
    return map;
  }, [notes]);

  // Last 20 weeks (140 days) heatmap columns
  const heatmapWeeks = useMemo(() => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(end.getDate() - 139);
    // Align start backwards to Monday
    const dayOfWeek = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeek);

    const weeks: Array<Array<{ iso: string; count: number; label: string }>> = [];
    const cur = new Date(start);
    while (cur <= end) {
      const col: Array<{ iso: string; count: number; label: string }> = [];
      for (let i = 0; i < 7; i += 1) {
        const iso = toIsoDate(cur);
        const entry = activityByDate.get(iso);
        col.push({
          iso,
          count: entry?.activityScore ?? 0,
          label: `${iso}: ${entry?.notes.length ?? 0} note(s), ${entry?.dueNotes.length ?? 0} due`,
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(col);
    }
    return weeks;
  }, [activityByDate]);

  // Monthly calendar grid
  const monthDays = useMemo(() => {
    const year = cursorMonth.getFullYear();
    const month = cursorMonth.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const leadingBlanks = (first.getDay() + 6) % 7;

    const cells: Array<{ iso: string; day: number; inMonth: boolean }> = [];
    for (let i = leadingBlanks; i > 0; i -= 1) {
      const d = new Date(year, month, 1 - i);
      cells.push({ iso: toIsoDate(d), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= last.getDate(); day += 1) {
      const d = new Date(year, month, day);
      cells.push({ iso: toIsoDate(d), day, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const d = new Date(year, month + 1, cells.length - (leadingBlanks + last.getDate()) + 1);
      cells.push({ iso: toIsoDate(d), day: d.getDate(), inMonth: false });
    }
    return cells;
  }, [cursorMonth]);

  const activeDaysCount = Array.from(activityByDate.values()).filter(
    (v) => v.activityScore > 0,
  ).length;
  const openTasksCount = tasks.filter((t) => !t.completed).length;
  const todayIso = toIsoDate(now);

  return (
    <div className="h-full overflow-y-auto p-6 bg-[#09090b]">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-emerald-400" />
              Calendar &amp; Activity Heatmap — {workspaceSlug}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Click any date to open or create its daily journal note (`journals/YYYY-MM-DD.md`).
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300">
              <Flame className="w-3.5 h-3.5 inline text-amber-400 mr-1" />
              {activeDaysCount} active day(s)
            </span>
            <span className="px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300">
              {openTasksCount} open task(s)
            </span>
          </div>
        </div>

        {/* Contribution Heatmap */}
        <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-zinc-200">
              20-Week Knowledge Activity Heatmap
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span>Less</span>
              <span className="w-3 h-3 rounded-sm bg-zinc-900 border border-zinc-800" />
              <span className="w-3 h-3 rounded-sm bg-emerald-950 border border-emerald-900" />
              <span className="w-3 h-3 rounded-sm bg-emerald-700" />
              <span className="w-3 h-3 rounded-sm bg-emerald-400" />
              <span>More</span>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {heatmapWeeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-1 shrink-0">
                {week.map((cell) => {
                  const bg =
                    cell.count === 0
                      ? "bg-zinc-900 border-zinc-800/80"
                      : cell.count === 1
                        ? "bg-emerald-950 border-emerald-900"
                        : cell.count === 2
                          ? "bg-emerald-700 border-emerald-600"
                          : "bg-emerald-400 border-emerald-300";
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      title={cell.label}
                      onClick={() => onOpenDailyForDate(cell.iso)}
                      className={`w-3.5 h-3.5 rounded-sm border transition hover:ring-1 hover:ring-white cursor-pointer ${bg}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Interactive Monthly Grid */}
        <div className="rounded-xl border border-zinc-800 bg-[#111114] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="text-sm font-semibold text-zinc-100">
              {cursorMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() =>
                  setCursorMonth(
                    new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() - 1, 1),
                  )
                }
                className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCursorMonth(new Date(now.getFullYear(), now.getMonth(), 1))
                }
                className="px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() =>
                  setCursorMonth(
                    new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1),
                  )
                }
                className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-950/60">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="px-2 py-1.5 text-[11px] font-medium text-zinc-500 text-center"
              >
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {monthDays.map((cell) => {
              const info = activityByDate.get(cell.iso);
              const isToday = cell.iso === todayIso;
              return (
                <div
                  key={cell.iso}
                  className={`min-h-[104px] border-r border-b border-zinc-800/70 p-2 flex flex-col gap-1 ${
                    cell.inMonth ? "bg-[#0e0e12]" : "bg-[#0a0a0d] opacity-55"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                        isToday
                          ? "bg-emerald-500 text-zinc-950 font-semibold"
                          : "text-zinc-400"
                      }`}
                    >
                      {cell.day}
                    </span>
                    <button
                      type="button"
                      title={`Open/create journal for ${cell.iso}`}
                      onClick={() => onOpenDailyForDate(cell.iso)}
                      className="p-0.5 rounded text-zinc-500 hover:text-emerald-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-1 overflow-hidden">
                    {info?.dueNotes.map((dn) => (
                      <button
                        key={`due-${dn.id}`}
                        type="button"
                        onClick={() => onOpenNoteById(dn.id)}
                        className="w-full text-left truncate px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                      >
                        Due: {dn.title}
                      </button>
                    ))}
                    {info?.notes.slice(0, 3).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => onOpenNoteById(n.id)}
                        className="w-full text-left truncate px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 text-[10px] text-zinc-200 flex items-center gap-1 cursor-pointer"
                      >
                        <FileText className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{n.title}</span>
                      </button>
                    ))}
                    {info && info.notes.length > 3 && (
                      <div className="text-[10px] text-zinc-500 px-1">
                        +{info.notes.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
