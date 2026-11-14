import { NextRequest, NextResponse } from "next/server";
import {
  AgentToolName,
  approvePendingAction,
  proposeAgentAction,
  rejectPendingAction,
} from "@/lib/ai/agent";
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
    SELECT a.id, a.conversation_id, a.workspace_id, w.slug as workspace_slug,
           a.tool_name, a.args_json, a.preview_diff, a.status, a.created_at, a.resolved_at
    FROM ai_pending_actions a
    JOIN workspaces w ON w.id = a.workspace_id
  `;
  const params: string[] = [];
  if (workspaceSlug && workspaceSlug !== "all") {
    sql += " WHERE w.slug = ?";
    params.push(workspaceSlug);
  }
  sql += " ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 40";

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    conversation_id: string;
    workspace_id: string;
    workspace_slug: string;
    tool_name: AgentToolName;
    args_json: string;
    preview_diff: string;
    status: "pending" | "approved" | "rejected";
    created_at: number;
    resolved_at: number | null;
  }>;

  return NextResponse.json({
    actions: rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      workspaceId: r.workspace_id,
      workspaceSlug: r.workspace_slug,
      toolName: r.tool_name,
      args: JSON.parse(r.args_json || "{}"),
      previewDiff: r.preview_diff,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    decision?: "approve" | "reject" | "propose";
    actionId?: string;
    workspaceSlug?: string;
    conversationId?: string;
    toolName?: AgentToolName;
    args?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.decision === "approve") {
    if (!body.actionId) {
      return NextResponse.json({ error: "actionId is required" }, { status: 400 });
    }
    try {
      const result = approvePendingAction(body.actionId);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to approve action" },
        { status: 400 },
      );
    }
  }

  if (body.decision === "reject") {
    if (!body.actionId) {
      return NextResponse.json({ error: "actionId is required" }, { status: 400 });
    }
    try {
      rejectPendingAction(body.actionId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to reject action" },
        { status: 400 },
      );
    }
  }

  if (body.decision === "propose") {
    const db = getDb();
    const ws = body.workspaceSlug
      ? (db.prepare("SELECT id FROM workspaces WHERE slug = ?").get(body.workspaceSlug) as
          | { id: string }
          | undefined)
      : undefined;
    if (!ws || !body.toolName) {
      return NextResponse.json(
        { error: "workspaceSlug and toolName are required" },
        { status: 400 },
      );
    }
    try {
      const proposal = proposeAgentAction({
        conversationId: body.conversationId || "",
        workspaceId: ws.id,
        providerId: "local-hybrid",
        toolName: body.toolName,
        args: body.args || {},
      });
      return NextResponse.json({ ok: true, proposal }, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Proposal blocked" },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({ error: "Unsupported decision action" }, { status: 400 });
}
