import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db = getDb();
  const workspaceSlug = req.nextUrl.searchParams.get("workspaceSlug");
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  let conversations: Array<{
    id: string;
    workspace_id: string | null;
    title: string;
    provider_id: string;
    context_scope_json: string;
    created_at: number;
    updated_at: number;
  }>;

  if (workspaceSlug && workspaceSlug !== "all") {
    const ws = db
      .prepare("SELECT id FROM workspaces WHERE slug = ?")
      .get(workspaceSlug) as { id: string } | undefined;
    if (!ws) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    conversations = db
      .prepare(
        "SELECT * FROM ai_conversations WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY updated_at DESC LIMIT 30",
      )
      .all(ws.id) as typeof conversations;
  } else {
    conversations = db
      .prepare("SELECT * FROM ai_conversations ORDER BY updated_at DESC LIMIT 30")
      .all() as typeof conversations;
  }

  const activeId = conversationId || conversations[0]?.id || null;
  const messages = activeId
    ? (
        db
          .prepare(
            "SELECT id, conversation_id, role, content, citations_json, tool_proposals_json, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC",
          )
          .all(activeId) as Array<{
          id: string;
          conversation_id: string;
          role: string;
          content: string;
          citations_json: string;
          tool_proposals_json: string;
          created_at: number;
        }>
      ).map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        role: m.role,
        content: m.content,
        citations: JSON.parse(m.citations_json || "[]"),
        toolProposals: JSON.parse(m.tool_proposals_json || "[]"),
        createdAt: m.created_at,
      }))
    : [];

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      workspaceId: c.workspace_id,
      title: c.title,
      providerId: c.provider_id,
      contextScope: JSON.parse(c.context_scope_json || "{}"),
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    activeConversationId: activeId,
    messages,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId query parameter is required" },
      { status: 400 },
    );
  }

  const db = getDb();
  db.prepare("DELETE FROM ai_conversations WHERE id = ?").run(conversationId);
  return NextResponse.json({ ok: true });
}
