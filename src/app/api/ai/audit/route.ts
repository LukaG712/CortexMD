import { NextRequest, NextResponse } from "next/server";
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

  let sql = `
    SELECT l.id, l.workspace_id, w.slug as workspace_slug, l.conversation_id,
           l.provider_id, l.tool_name, l.target_path, l.action_status, l.details_json, l.created_at
    FROM ai_audit_logs l
    LEFT JOIN workspaces w ON w.id = l.workspace_id
  `;
  const params: string[] = [];
  if (workspaceSlug && workspaceSlug !== "all") {
    sql += " WHERE w.slug = ?";
    params.push(workspaceSlug);
  }
  sql += " ORDER BY l.created_at DESC LIMIT 60";

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    workspace_id: string | null;
    workspace_slug: string | null;
    conversation_id: string | null;
    provider_id: string;
    tool_name: string;
    target_path: string;
    action_status: string;
    details_json: string;
    created_at: number;
  }>;

  return NextResponse.json({
    logs: rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceSlug: r.workspace_slug,
      conversationId: r.conversation_id,
      providerId: r.provider_id,
      toolName: r.tool_name,
      targetPath: r.target_path,
      actionStatus: r.action_status,
      details: JSON.parse(r.details_json || "{}"),
      createdAt: r.created_at,
    })),
  });
}
