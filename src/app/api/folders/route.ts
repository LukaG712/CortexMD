import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireWorkspaceRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import { listWorkspaceFolders, normalizeRelPath, resolveVaultPath } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface WorkspaceRow {
  id: string;
  slug: string;
  root_path: string;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { workspaceSlug?: string; folderPath?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const workspaceSlug = (body.workspaceSlug || "personal").trim();
  const db = getDb();
  const ws = db
    .prepare("SELECT id, slug, root_path FROM workspaces WHERE slug = ?")
    .get(workspaceSlug) as WorkspaceRow | undefined;
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const roleCheck = requireWorkspaceRole(auth.session, ws.id, "editor");
  if ("error" in roleCheck) {
    return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
  }

  const rawFolder = (body.folderPath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!rawFolder) {
    return NextResponse.json({ error: "Folder path is required" }, { status: 400 });
  }

  const normalized = normalizeRelPath(rawFolder);
  if (
    !normalized ||
    normalized === "." ||
    normalized.split("/").some((seg) => !seg || seg.startsWith(".") || seg === "assets")
  ) {
    return NextResponse.json(
      { error: "Invalid folder path (cannot start with '.' or use reserved 'assets')" },
      { status: 400 },
    );
  }

  let targetDir: string;
  try {
    targetDir = resolveVaultPath(ws.root_path, normalized);
  } catch {
    return NextResponse.json({ error: "Folder path escapes workspace root" }, { status: 400 });
  }

  fs.mkdirSync(targetDir, { recursive: true });
  broadcastEvent({
    type: "workspace:indexed",
    workspaceSlug: ws.slug,
    relPath: normalized,
  });

  return NextResponse.json(
    {
      ok: true,
      folder: normalized,
      folders: listWorkspaceFolders(ws.root_path),
    },
    { status: 201 },
  );
}
