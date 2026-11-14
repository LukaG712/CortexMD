import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getVaultsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import {
  buildWorkspaceGraph,
  ensureAllWorkspacesIndexed,
  extractWorkspaceTasks,
  reconcileWorkspace,
} from "@/lib/indexer";
import { NOTE_TEMPLATES, sanitizeSlug, writeMarkdownFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  ensureAllWorkspacesIndexed();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT w.*, COUNT(CASE WHEN n.is_trashed = 0 THEN 1 END) as note_count,
              COUNT(CASE WHEN n.is_trashed = 1 THEN 1 END) as trash_count
       FROM workspaces w
       LEFT JOIN notes n ON n.workspace_id = w.id
       GROUP BY w.id
       ORDER BY w.created_at ASC`,
    )
    .all() as Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    root_path: string;
    ai_enabled: number;
    created_at: number;
    note_count: number;
    trash_count: number;
  }>;

  const requestedSlug = req.nextUrl.searchParams.get("slug");
  const include = (req.nextUrl.searchParams.get("include") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const active = rows.find((r) => r.slug === requestedSlug) || rows[0] || null;
  let extras: Record<string, unknown> = {};

  if (active && include.length > 0) {
    if (include.includes("graph") || include.includes("orphans")) {
      const graph = buildWorkspaceGraph(active.id);
      if (include.includes("graph")) extras.graph = graph;
      if (include.includes("orphans")) {
        extras.orphans = graph.nodes.filter((n) => n.isOrphan);
      }
    }
    if (include.includes("tasks")) {
      extras.tasks = extractWorkspaceTasks(active.id);
    }
    if (include.includes("tags")) {
      const tagRows = db
        .prepare("SELECT tags_json FROM notes WHERE workspace_id = ? AND is_trashed = 0")
        .all(active.id) as Array<{ tags_json: string }>;
      const counts = new Map<string, number>();
      for (const tr of tagRows) {
        const parsed = JSON.parse(tr.tags_json || "[]") as string[];
        for (const t of parsed) {
          counts.set(t, (counts.get(t) || 0) + 1);
        }
      }
      extras.tags = Array.from(counts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    }
  }

  return NextResponse.json({
    workspaces: rows,
    activeWorkspace: active,
    templates: NOTE_TEMPLATES.map(({ id, name, objectType, description, folder }) => ({
      id,
      name,
      objectType,
      description,
      folder,
    })),
    ...extras,
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { name?: string; description?: string; icon?: string; color?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Workspace name is required" }, { status: 400 });
  }

  const db = getDb();
  let slug = sanitizeSlug(name);
  const existing = db.prepare("SELECT id FROM workspaces WHERE slug = ?").get(slug);
  if (existing) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const rootPath = path.join(getVaultsDir(), slug);
  fs.mkdirSync(rootPath, { recursive: true });

  const id = crypto.randomUUID();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO workspaces (id, slug, name, description, icon, color, root_path, ai_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    slug,
    name,
    (body.description || "Custom Markdown workspace").trim(),
    body.icon || "folder",
    body.color || "#3b82f6",
    rootPath,
    now,
  );

  writeMarkdownFile(
    rootPath,
    "Welcome.md",
    `---
type: moc
created: ${today}
tags: [moc, ${slug}]
---

# ${name}

Workspace initialized in CortexMD. Add notes, folders, or import an existing Obsidian vault here.
`,
  );

  reconcileWorkspace(id);
  broadcastEvent({ type: "workspace:indexed", workspaceSlug: slug });

  const created = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  return NextResponse.json({ workspace: created }, { status: 201 });
}
