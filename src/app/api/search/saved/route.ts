import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db = getDb();
  const slug = req.nextUrl.searchParams.get("workspaceSlug");
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

  const rows = db
    .prepare(
      `SELECT id, workspace_id, name, query, created_at
       FROM saved_searches
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
    )
    .all(ws.id) as unknown as Array<{
    id: string;
    workspace_id: string;
    name: string;
    query: string;
    created_at: number;
  }>;

  return NextResponse.json({
    workspaceSlug: ws.slug,
    searches: rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      query: r.query,
      createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "saved-search"), 40, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: { workspaceSlug?: string; name?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const query = (body.query || "").trim();
  if (!name || !query) {
    return NextResponse.json(
      { error: "Both name and query are required" },
      { status: 400 },
    );
  }

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

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO saved_searches (id, workspace_id, name, query, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, ws.id, name.slice(0, 80), query.slice(0, 300), now);

  return NextResponse.json(
    {
      search: {
        id,
        workspaceId: ws.id,
        name: name.slice(0, 80),
        query: query.slice(0, 300),
        createdAt: now,
      },
    },
    { status: 201 },
  );
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id parameter is required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
  return NextResponse.json({ deleted: true });
}
