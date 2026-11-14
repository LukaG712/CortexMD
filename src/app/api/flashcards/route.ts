import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";
import { FlashcardItem } from "@/lib/types";

export const dynamic = "force-dynamic";

interface FlashcardRow {
  id: string;
  workspace_id: string;
  note_id: string;
  rel_path: string;
  front: string;
  back: string;
  line_number: number;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  due_at: number;
  last_reviewed_at: number | null;
  updated_at: number;
}

function rowToItem(row: FlashcardRow): FlashcardItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    noteId: row.note_id,
    relPath: row.rel_path,
    front: row.front,
    back: row.back,
    lineNumber: row.line_number,
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    repetitions: row.repetitions,
    dueAt: row.due_at,
    lastReviewedAt: row.last_reviewed_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  ensureAllWorkspacesIndexed();
  const db = getDb();
  const slug = req.nextUrl.searchParams.get("workspaceSlug");
  const dueOnly = req.nextUrl.searchParams.get("dueOnly") === "true";

  const ws = slug
    ? (db
        .prepare("SELECT id, slug FROM workspaces WHERE slug = ?")
        .get(slug) as unknown as { id: string; slug: string } | undefined)
    : (db
        .prepare("SELECT id, slug FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as { id: string; slug: string } | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const now = Date.now();
  const rows = db
    .prepare(
      dueOnly
        ? `SELECT f.* FROM flashcards f
           JOIN notes n ON n.id = f.note_id
           WHERE f.workspace_id = ? AND n.is_trashed = 0 AND f.due_at <= ?
           ORDER BY f.due_at ASC`
        : `SELECT f.* FROM flashcards f
           JOIN notes n ON n.id = f.note_id
           WHERE f.workspace_id = ? AND n.is_trashed = 0
           ORDER BY f.due_at ASC`,
    )
    .all(...(dueOnly ? [ws.id, now] : [ws.id])) as unknown as FlashcardRow[];

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) as total_count,
         SUM(CASE WHEN f.due_at <= ? THEN 1 ELSE 0 END) as due_count
       FROM flashcards f
       JOIN notes n ON n.id = f.note_id
       WHERE f.workspace_id = ? AND n.is_trashed = 0`,
    )
    .get(now, ws.id) as unknown as { total_count: number; due_count: number | null };

  return NextResponse.json({
    workspaceSlug: ws.slug,
    totalCount: counts.total_count || 0,
    dueCount: counts.due_count || 0,
    cards: rows.map(rowToItem),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "flashcard-review"), 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: { cardId?: string; rating?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const cardId = (body.cardId || "").trim();
  const rating = Number(body.rating);
  if (!cardId || ![1, 2, 3, 4].includes(rating)) {
    return NextResponse.json(
      { error: "cardId and rating (1=Again, 2=Hard, 3=Good, 4=Easy) are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const card = db
    .prepare("SELECT * FROM flashcards WHERE id = ?")
    .get(cardId) as unknown as FlashcardRow | undefined;
  if (!card) {
    return NextResponse.json({ error: "Flashcard not found" }, { status: 404 });
  }

  const now = Date.now();
  const q = rating === 1 ? 1 : rating === 2 ? 3 : rating === 3 ? 4 : 5;
  let repetitions = card.repetitions;
  let intervalDays = card.interval_days;
  let easeFactor = card.ease_factor || 2.5;
  let dueAt: number;

  if (rating === 1) {
    repetitions = 0;
    intervalDays = 0;
    easeFactor = Math.max(1.3, Number((easeFactor - 0.2).toFixed(2)));
    dueAt = now + 60_000;
  } else {
    repetitions += 1;
    if (repetitions === 1) {
      intervalDays = rating === 4 ? 3 : rating === 3 ? 1 : 0.5;
    } else if (repetitions === 2) {
      intervalDays = rating === 2 ? 3 : rating === 4 ? 8 : 6;
    } else {
      const bonus = rating === 2 ? 0.8 : rating === 4 ? 1.3 : 1;
      intervalDays = Math.max(1, Math.round(intervalDays * easeFactor * bonus));
    }
    easeFactor = Math.max(
      1.3,
      Number((easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).toFixed(2)),
    );
    dueAt = now + Math.round(intervalDays * 86_400_000);
  }

  db.prepare(
    `UPDATE flashcards
     SET interval_days = ?, ease_factor = ?, repetitions = ?, due_at = ?, last_reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(intervalDays, easeFactor, repetitions, dueAt, now, now, cardId);

  const updated = db
    .prepare("SELECT * FROM flashcards WHERE id = ?")
    .get(cardId) as unknown as FlashcardRow;

  return NextResponse.json({ card: rowToItem(updated) });
}
