import { NextRequest, NextResponse } from "next/server";
import { runVaultGardener } from "@/lib/ai/agent";
import { ProviderId } from "@/lib/ai/providers";
import { checkRateLimit, getClientKey, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rate = checkRateLimit(getClientKey(req, "ai-gardener"), 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Vault Gardener rate limit exceeded." },
      { status: 429 },
    );
  }

  let body: { workspaceSlug?: string; providerId?: ProviderId } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
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

  const result = runVaultGardener(ws.id, body.providerId || "local-hybrid");
  return NextResponse.json({
    workspaceSlug: ws.slug,
    proposals: result.proposals,
    stats: result.stats,
  });
}
