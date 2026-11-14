import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientKey,
  hashPassword,
  requireAuth,
  WorkspaceRole,
} from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const db = getDb();
  const users = db
    .prepare(
      "SELECT id, username, role, created_at FROM users ORDER BY created_at ASC",
    )
    .all() as unknown as Array<{
    id: string;
    username: string;
    role: string;
    created_at: number;
  }>;

  const memberships = db
    .prepare(
      `SELECT wm.user_id, wm.workspace_id, wm.role, w.slug as workspace_slug
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id`,
    )
    .all() as unknown as Array<{
    user_id: string;
    workspace_id: string;
    role: WorkspaceRole;
    workspace_slug: string;
  }>;

  const memByUser = new Map<
    string,
    Array<{ workspaceId: string; workspaceSlug: string; role: WorkspaceRole }>
  >();
  for (const m of memberships) {
    const arr = memByUser.get(m.user_id) || [];
    arr.push({
      workspaceId: m.workspace_id,
      workspaceSlug: m.workspace_slug,
      role: m.role,
    });
    memByUser.set(m.user_id, arr);
  }

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.created_at,
      memberships: memByUser.get(u.id) || [],
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const rate = checkRateLimit(getClientKey(req, "users-admin"), 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: {
    action?: "createUser" | "assignRole";
    username?: string;
    password?: string;
    role?: WorkspaceRole;
    userId?: string;
    workspaceSlug?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const db = getDb();
  const action = body.action || "createUser";

  if (action === "assignRole") {
    const userId = (body.userId || "").trim();
    const role = body.role;
    const slug = (body.workspaceSlug || "").trim();
    if (!userId || !slug || !role || !["admin", "editor", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "userId, workspaceSlug, and valid role (admin|editor|viewer) are required" },
        { status: 400 },
      );
    }
    const ws = db
      .prepare("SELECT id FROM workspaces WHERE slug = ?")
      .get(slug) as unknown as { id: string } | undefined;
    const usr = db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(userId) as unknown as { id: string } | undefined;
    if (!ws || !usr) {
      return NextResponse.json({ error: "User or workspace not found" }, { status: 404 });
    }

    db.prepare(
      `INSERT INTO workspace_members (user_id, workspace_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role`,
    ).run(userId, ws.id, role, Date.now());

    return NextResponse.json({ updated: true, userId, workspaceSlug: slug, role });
  }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  const role: WorkspaceRole =
    body.role && ["admin", "editor", "viewer"].includes(body.role)
      ? body.role
      : "editor";

  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-32 lowercase alphanumeric/._- characters" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username) as unknown as { id: string } | undefined;
  if (existing) {
    return NextResponse.json({ error: "Username already exists" }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const { hash, salt } = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, username, hash, salt, role, now);

  if (body.workspaceSlug) {
    const ws = db
      .prepare("SELECT id FROM workspaces WHERE slug = ?")
      .get(body.workspaceSlug) as unknown as { id: string } | undefined;
    if (ws) {
      db.prepare(
        `INSERT INTO workspace_members (user_id, workspace_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(id, ws.id, role, now);
    }
  }

  return NextResponse.json(
    {
      user: {
        id,
        username,
        role,
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
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const userId = (req.nextUrl.searchParams.get("userId") || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (userId === auth.session.userId) {
    return NextResponse.json(
      { error: "Cannot delete the currently logged-in admin user" },
      { status: 400 },
    );
  }

  const db = getDb();
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return NextResponse.json({ deleted: true });
}
