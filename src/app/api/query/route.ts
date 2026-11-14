import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { executeCortexQuery } from "@/lib/dataview";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { workspaceSlug?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const rawQuery = (body.query || "").trim();
  if (!rawQuery) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  ensureAllWorkspacesIndexed();

  const db = getDb();
  const ws = body.workspaceSlug
    ? (db
        .prepare("SELECT id, slug FROM workspaces WHERE slug = ?")
        .get(body.workspaceSlug) as unknown as { id: string; slug: string } | undefined)
    : (db
        .prepare("SELECT id, slug FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as { id: string; slug: string } | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const result = executeCortexQuery(ws.id, rawQuery);
  return NextResponse.json({ result });
}
