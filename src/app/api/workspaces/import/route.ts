import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getVaultsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";
import { reconcileWorkspace } from "@/lib/indexer";
import {
  normalizeRelPath,
  resolveVaultPath,
  sanitizeSlug,
  writeMarkdownFile,
} from "@/lib/storage";

interface ImportFileEntry {
  relPath: string;
  content?: string;
  contentBase64?: string;
  buffer?: Buffer;
}

function shouldSkipImportedPath(relPath: string): boolean {
  const parts = relPath.replaceAll("\\", "/").split("/");
  return parts.some(
    (p) => p === ".obsidian" || p === ".trash" || p === ".git" || p === ".DS_Store",
  );
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const contentType = req.headers.get("content-type") || "";
  let workspaceName = "";
  let targetSlug = "";
  const entries: ImportFileEntry[] = [];

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    workspaceName = String(formData.get("workspaceName") || "").trim();
    targetSlug = String(formData.get("workspaceSlug") || "").trim();

    let pathsMeta: string[] = [];
    const pathsRaw = formData.get("paths");
    if (typeof pathsRaw === "string" && pathsRaw.trim()) {
      try {
        pathsMeta = JSON.parse(pathsRaw) as string[];
      } catch {
        pathsMeta = [];
      }
    }

    const files = formData.getAll("files");
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (!(item instanceof File)) continue;
      const rawPath = pathsMeta[i] || item.name;
      const buf = Buffer.from(await item.arrayBuffer());
      entries.push({ relPath: rawPath, buffer: buf });
    }
  } else {
    let body: {
      workspaceName?: string;
      workspaceSlug?: string;
      files?: ImportFileEntry[];
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    workspaceName = (body.workspaceName || "").trim();
    targetSlug = (body.workspaceSlug || "").trim();
    if (Array.isArray(body.files)) {
      entries.push(...body.files);
    }
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No files were supplied for import" },
      { status: 400 },
    );
  }

  const db = getDb();
  let workspace = targetSlug
    ? (db.prepare("SELECT * FROM workspaces WHERE slug = ?").get(targetSlug) as
        | { id: string; slug: string; name: string; root_path: string }
        | undefined)
    : undefined;

  if (!workspace) {
    const name = workspaceName || "Imported Obsidian Vault";
    let slug = sanitizeSlug(name);
    if (db.prepare("SELECT id FROM workspaces WHERE slug = ?").get(slug)) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }
    const rootPath = path.join(getVaultsDir(), slug);
    fs.mkdirSync(rootPath, { recursive: true });
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, description, icon, color, root_path, ai_enabled, created_at)
       VALUES (?, ?, ?, ?, 'upload', '#8b5cf6', ?, 1, ?)`,
    ).run(id, slug, name, "Imported Markdown / Obsidian vault", rootPath, Date.now());
    workspace = { id, slug, name, root_path: rootPath };
  }

  // Strip shared top-level vault folder name when uploaded via webkitdirectory
  const cleanedPaths = entries.map((e) => e.relPath.replaceAll("\\", "/").replace(/^\/+/, ""));
  const firstSegments = new Set(
    cleanedPaths.map((p) => (p.includes("/") ? p.split("/")[0] : "")).filter(Boolean),
  );
  const stripLeadingVaultDir =
    firstSegments.size === 1 && cleanedPaths.every((p) => p.includes("/"));
  const sharedPrefix = stripLeadingVaultDir ? `${Array.from(firstSegments)[0]}/` : "";

  let importedMdCount = 0;
  let importedAssetCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let rawRel = cleanedPaths[i];
    if (sharedPrefix && rawRel.startsWith(sharedPrefix)) {
      rawRel = rawRel.slice(sharedPrefix.length);
    }
    if (!rawRel || shouldSkipImportedPath(rawRel)) {
      skippedCount++;
      continue;
    }

    let safeRel: string;
    try {
      safeRel = normalizeRelPath(rawRel);
    } catch {
      skippedCount++;
      continue;
    }

    const isMd = safeRel.toLowerCase().endsWith(".md");
    if (isMd) {
      const text =
        entry.content !== undefined
          ? entry.content
          : entry.buffer
            ? entry.buffer.toString("utf8")
            : entry.contentBase64
              ? Buffer.from(entry.contentBase64, "base64").toString("utf8")
              : "";
      writeMarkdownFile(workspace.root_path, safeRel, text);
      importedMdCount++;
    } else {
      const buf =
        entry.buffer ||
        (entry.contentBase64
          ? Buffer.from(entry.contentBase64, "base64")
          : entry.content !== undefined
            ? Buffer.from(entry.content, "utf8")
            : null);
      if (!buf) {
        skippedCount++;
        continue;
      }
      const dest = resolveVaultPath(workspace.root_path, safeRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      importedAssetCount++;
    }
  }

  reconcileWorkspace(workspace.id);
  broadcastEvent({ type: "workspace:indexed", workspaceSlug: workspace.slug });

  return NextResponse.json(
    {
      workspace,
      importedMdCount,
      importedAssetCount,
      skippedCount,
    },
    { status: 201 },
  );
}
