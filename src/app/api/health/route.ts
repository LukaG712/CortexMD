import { NextResponse } from "next/server";
import { ensureBootstrapAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  ensureBootstrapAdmin();
  ensureAllWorkspacesIndexed();

  const workspaceCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM workspaces").get() as { cnt: number }
  ).cnt;
  const noteCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM notes WHERE is_trashed = 0").get() as {
      cnt: number;
    }
  ).cnt;

  return NextResponse.json({
    ok: true,
    status: "healthy",
    workspaces: workspaceCount,
    notes: noteCount,
    timestamp: Date.now(),
  });
}
