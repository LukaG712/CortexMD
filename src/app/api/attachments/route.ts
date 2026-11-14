import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeRelPath, resolveVaultPath } from "@/lib/storage";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const workspaceSlug = req.nextUrl.searchParams.get("workspaceSlug");
  const relPath = req.nextUrl.searchParams.get("path");
  if (!workspaceSlug || !relPath) {
    return NextResponse.json(
      { error: "workspaceSlug and path are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const ws = db
    .prepare("SELECT root_path FROM workspaces WHERE slug = ?")
    .get(workspaceSlug) as { root_path: string } | undefined;
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  let fullPath: string;
  try {
    fullPath = resolveVaultPath(ws.root_path, relPath);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid attachment path" },
      { status: 400 },
    );
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const bytes = fs.readFileSync(fullPath);

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
  if (ext === ".svg") {
    headers["Content-Security-Policy"] = "sandbox";
    headers["Content-Disposition"] = `attachment; filename="${path.basename(fullPath)}"`;
  }

  return new NextResponse(bytes, { status: 200, headers });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const formData = await req.formData();
  const workspaceSlug = String(formData.get("workspaceSlug") || "").trim();
  const file = formData.get("file");

  if (!workspaceSlug || !(file instanceof File)) {
    return NextResponse.json(
      { error: "workspaceSlug and multipart file are required" },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Attachment exceeds 20 MB limit" },
      { status: 413 },
    );
  }

  const db = getDb();
  const ws = db
    .prepare("SELECT root_path, slug FROM workspaces WHERE slug = ?")
    .get(workspaceSlug) as { root_path: string; slug: string } | undefined;
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment.bin";
  const relPath = normalizeRelPath(`assets/${Date.now()}-${safeName}`);
  const fullPath = resolveVaultPath(ws.root_path, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(fullPath, buf);

  const url = `/api/attachments?workspaceSlug=${encodeURIComponent(ws.slug)}&path=${encodeURIComponent(relPath)}`;
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(safeName);
  const markdownEmbed = isImage
    ? `![${file.name}](${url})`
    : `[${file.name}](${url})`;

  return NextResponse.json({ relPath, url, markdownEmbed }, { status: 201 });
}
