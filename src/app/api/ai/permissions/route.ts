import { NextRequest, NextResponse } from "next/server";
import {
  deleteFolderPermission,
  listFolderPermissions,
  setFolderPermission,
} from "@/lib/ai/acl";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const workspaceSlug = req.nextUrl.searchParams.get("workspaceSlug");
  const db = getDb();
  const ws = workspaceSlug
    ? (db.prepare("SELECT id FROM workspaces WHERE slug = ?").get(workspaceSlug) as
        | { id: string }
        | undefined)
    : (db
        .prepare("SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as { id: string } | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({ rules: listFolderPermissions(ws.id) });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    workspaceSlug?: string;
    folderPrefix?: string;
    permission?: "allow" | "deny";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (
    !body.workspaceSlug ||
    !body.folderPrefix?.trim() ||
    (body.permission !== "allow" && body.permission !== "deny")
  ) {
    return NextResponse.json(
      { error: "workspaceSlug, folderPrefix, and permission ('allow' | 'deny') are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE slug = ?")
    .get(body.workspaceSlug) as { id: string } | undefined;
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const rule = setFolderPermission(ws.id, body.folderPrefix, body.permission);
  return NextResponse.json({ rule, rules: listFolderPermissions(ws.id) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const workspaceSlug = req.nextUrl.searchParams.get("workspaceSlug");
  const ruleId = req.nextUrl.searchParams.get("ruleId");
  if (!workspaceSlug || !ruleId) {
    return NextResponse.json(
      { error: "workspaceSlug and ruleId query parameters are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE slug = ?")
    .get(workspaceSlug) as { id: string } | undefined;
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  deleteFolderPermission(ws.id, ruleId);
  return NextResponse.json({ rules: listFolderPermissions(ws.id) });
}
