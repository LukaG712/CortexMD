import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientKey,
  requireAuth,
  requireWorkspaceRole,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  createVaultGitCommit,
  getVaultGitStatusAndLog,
} from "@/lib/git-sync";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { slug } = await context.params;
  const db = getDb();
  const ws = db
    .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE slug = ?")
    .get(slug) as unknown as
    | { id: string; slug: string; name: string; root_path: string }
    | undefined;

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const status = getVaultGitStatusAndLog(ws.root_path);
  return NextResponse.json({
    workspaceSlug: ws.slug,
    ...status,
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "git-snapshot"), 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { slug } = await context.params;
  const db = getDb();
  const ws = db
    .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE slug = ?")
    .get(slug) as unknown as
    | { id: string; slug: string; name: string; root_path: string }
    | undefined;

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const rbac = requireWorkspaceRole(auth.session, ws.id, "editor");
  if ("error" in rbac) {
    return NextResponse.json({ error: rbac.error }, { status: rbac.status });
  }

  let body: { message?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const commitResult = createVaultGitCommit(ws.root_path, body.message);
    const status = getVaultGitStatusAndLog(ws.root_path);
    return NextResponse.json({
      workspaceSlug: ws.slug,
      ...commitResult,
      ...status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Git snapshot failed" },
      { status: 500 },
    );
  }
}
