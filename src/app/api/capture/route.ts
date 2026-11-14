import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientKey,
  getSessionFromRequest,
  requireWorkspaceRole,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import {
  ensureAllWorkspacesIndexed,
  indexSingleFile,
  resolveWorkspaceLinkTargets,
} from "@/lib/indexer";
import { normalizeRelPath, resolveVaultPath, writeMarkdownFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

function isBearerTokenValid(req: NextRequest): boolean {
  const expected = process.env.CORTEX_CAPTURE_TOKEN?.trim();
  if (!expected) return false;
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const provided = authHeader.slice(7).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const bearerAuthorized = isBearerTokenValid(req);
  const session = bearerAuthorized ? null : getSessionFromRequest(req);

  if (!bearerAuthorized && !session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (session && session.csrfToken !== "proxy-oauth") {
    const headerToken = req.headers.get("x-csrf-token");
    if (!headerToken || headerToken !== session.csrfToken) {
      return NextResponse.json({ error: "Invalid or missing CSRF token" }, { status: 403 });
    }
  }

  const rate = checkRateLimit(getClientKey(req, "quick-capture"), 45, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: {
    workspaceSlug?: string;
    title?: string;
    text?: string;
    url?: string;
    tags?: string[];
    target?: "inbox" | "daily";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const text = (body.text || "").trim();
  const url = (body.url || "").trim();
  if (!title && !text && !url) {
    return NextResponse.json(
      { error: "At least one of title, text, or url is required" },
      { status: 400 },
    );
  }

  ensureAllWorkspacesIndexed();
  const db = getDb();
  const ws = body.workspaceSlug
    ? (db
        .prepare("SELECT id, slug, root_path FROM workspaces WHERE slug = ?")
        .get(body.workspaceSlug) as unknown as
        | { id: string; slug: string; root_path: string }
        | undefined)
    : (db
        .prepare("SELECT id, slug, root_path FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as
        | { id: string; slug: string; root_path: string }
        | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (session) {
    const rbac = requireWorkspaceRole(session, ws.id, "editor");
    if ("error" in rbac) {
      return NextResponse.json({ error: rbac.error }, { status: rbac.status });
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const timeStamp = new Date().toISOString().slice(11, 16);
  const relPath =
    body.target === "daily"
      ? normalizeRelPath(`journals/${todayIso}.md`)
      : normalizeRelPath("Inbox/Quick Captures.md");

  let fullPath: string;
  try {
    fullPath = resolveVaultPath(ws.root_path, relPath);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid capture path" },
      { status: 400 },
    );
  }

  const exists = fs.existsSync(fullPath);
  const existingContent = exists
    ? fs.readFileSync(fullPath, "utf8")
    : body.target === "daily"
      ? `---\ntype: daily\ndate: ${todayIso}\ntags: [daily, capture]\n---\n\n# Daily Note — ${todayIso}\n\n## Quick Captures\n`
      : `---\ntype: inbox\ntags: [inbox, capture]\n---\n\n# Quick Captures\n\n`;

  const tagList = Array.isArray(body.tags)
    ? body.tags
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean)
    : [];
  const tagText = tagList.length > 0 ? ` ${tagList.map((t) => `#${t}`).join(" ")}` : "";
  const urlPart = url ? ` ([link](${url}))` : "";
  const titlePart = title ? `**${title}**` : "";
  const bodyPart = [titlePart, text].filter(Boolean).join(" — ");
  const entryLine = `- \`${timeStamp}\` ${bodyPart || "Clipped link"}${urlPart}${tagText}`;

  const nextContent = `${existingContent.trimEnd()}\n${entryLine}\n`;
  writeMarkdownFile(ws.root_path, relPath, nextContent);
  const noteId = indexSingleFile(ws.id, relPath, { force: true });
  resolveWorkspaceLinkTargets(ws.id);

  if (noteId) {
    broadcastEvent({
      type: exists ? "note:updated" : "note:created",
      workspaceSlug: ws.slug,
      relPath,
      noteId,
    });
  }

  return NextResponse.json(
    {
      captured: true,
      workspaceSlug: ws.slug,
      relPath,
      noteId,
      entryLine,
    },
    { status: 201 },
  );
}
