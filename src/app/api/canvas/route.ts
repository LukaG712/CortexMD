import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireWorkspaceRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeRelPath, resolveVaultPath } from "@/lib/storage";
import { JsonCanvasDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

function listCanvasFilesOnDisk(rootPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootPath)) return results;

  const walk = (dir: string, relBase: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".canvas")) {
        results.push(rel.replace(/\\/g, "/"));
      }
    }
  };
  walk(rootPath, "");
  return results.sort();
}

function sanitizeCanvasDoc(input: unknown): JsonCanvasDoc {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes = rawNodes
    .filter((n): n is Record<string, unknown> => Boolean(n && typeof n === "object"))
    .map((n, idx) => ({
      id: typeof n.id === "string" && n.id ? n.id : `node-${idx + 1}`,
      type: (["text", "file", "link", "group"].includes(String(n.type))
        ? String(n.type)
        : "text") as "text" | "file" | "link" | "group",
      x: Number.isFinite(Number(n.x)) ? Number(n.x) : 60 + idx * 40,
      y: Number.isFinite(Number(n.y)) ? Number(n.y) : 60 + idx * 40,
      width: Math.max(120, Number.isFinite(Number(n.width)) ? Number(n.width) : 240),
      height: Math.max(70, Number.isFinite(Number(n.height)) ? Number(n.height) : 130),
      ...(typeof n.color === "string" && n.color ? { color: n.color } : {}),
      ...(typeof n.text === "string" ? { text: n.text } : {}),
      ...(typeof n.file === "string" ? { file: n.file } : {}),
      ...(typeof n.url === "string" ? { url: n.url } : {}),
      ...(typeof n.label === "string" ? { label: n.label } : {}),
    }));

  const edges = rawEdges
    .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === "object"))
    .map((e, idx) => ({
      id: typeof e.id === "string" && e.id ? e.id : `edge-${idx + 1}`,
      fromNode: String(e.fromNode || ""),
      toNode: String(e.toNode || ""),
      ...(typeof e.fromSide === "string" ? { fromSide: e.fromSide as "top" | "right" | "bottom" | "left" } : {}),
      ...(typeof e.toSide === "string" ? { toSide: e.toSide as "top" | "right" | "bottom" | "left" } : {}),
      ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
      ...(typeof e.color === "string" && e.color ? { color: e.color } : {}),
    }))
    .filter((e) => e.fromNode && e.toNode);

  return { nodes, edges };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const slug = req.nextUrl.searchParams.get("workspaceSlug") || "";
  const reqPath = req.nextUrl.searchParams.get("path") || "";

  const db = getDb();
  const ws = slug
    ? (db
        .prepare("SELECT id, slug, name, root_path FROM workspaces WHERE slug = ?")
        .get(slug) as unknown as
        | { id: string; slug: string; name: string; root_path: string }
        | undefined)
    : (db
        .prepare("SELECT id, slug, name, root_path FROM workspaces ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as
        | { id: string; slug: string; name: string; root_path: string }
        | undefined);

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const files = listCanvasFilesOnDisk(ws.root_path);
  let activePath = "";
  let canvas: JsonCanvasDoc | null = null;

  if (reqPath) {
    let clean: string;
    try {
      clean = normalizeRelPath(reqPath.endsWith(".canvas") ? reqPath : `${reqPath}.canvas`);
      const full = resolveVaultPath(ws.root_path, clean);
      if (fs.existsSync(full)) {
        activePath = clean;
        canvas = sanitizeCanvasDoc(JSON.parse(fs.readFileSync(full, "utf8")));
      } else {
        return NextResponse.json({ error: "Canvas file not found" }, { status: 404 });
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid canvas path" },
        { status: 400 },
      );
    }
  } else if (files.length > 0) {
    activePath = files[0];
    try {
      const full = resolveVaultPath(ws.root_path, activePath);
      canvas = sanitizeCanvasDoc(JSON.parse(fs.readFileSync(full, "utf8")));
    } catch {
      canvas = { nodes: [], edges: [] };
    }
  }

  return NextResponse.json({
    workspaceSlug: ws.slug,
    files,
    activePath,
    canvas,
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    workspaceSlug?: string;
    path?: string;
    canvas?: JsonCanvasDoc;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

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

  const rbac = requireWorkspaceRole(auth.session, ws.id, "editor");
  if ("error" in rbac) {
    return NextResponse.json({ error: rbac.error }, { status: rbac.status });
  }

  const rawPath = (body.path || "Overview.canvas").trim();
  let cleanPath: string;
  let fullPath: string;
  try {
    cleanPath = normalizeRelPath(
      rawPath.toLowerCase().endsWith(".canvas") ? rawPath : `${rawPath}.canvas`,
    );
    fullPath = resolveVaultPath(ws.root_path, cleanPath);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid canvas path" },
      { status: 400 },
    );
  }

  const existed = fs.existsSync(fullPath);
  const doc = sanitizeCanvasDoc(body.canvas);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(doc, null, 2), "utf8");

  return NextResponse.json(
    {
      workspaceSlug: ws.slug,
      path: cleanPath,
      canvas: doc,
      files: listCanvasFilesOnDisk(ws.root_path),
    },
    { status: existed ? 200 : 201 },
  );
}

export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const slug = req.nextUrl.searchParams.get("workspaceSlug") || "";
  const reqPath = req.nextUrl.searchParams.get("path") || "";
  if (!reqPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const db = getDb();
  const ws = slug
    ? (db
        .prepare("SELECT id, slug, root_path FROM workspaces WHERE slug = ?")
        .get(slug) as unknown as { id: string; slug: string; root_path: string } | undefined)
    : undefined;

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const rbac = requireWorkspaceRole(auth.session, ws.id, "editor");
  if ("error" in rbac) {
    return NextResponse.json({ error: rbac.error }, { status: rbac.status });
  }

  try {
    const clean = normalizeRelPath(reqPath);
    const full = resolveVaultPath(ws.root_path, clean);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
    return NextResponse.json({ deleted: true, files: listCanvasFilesOnDisk(ws.root_path) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid canvas path" },
      { status: 400 },
    );
  }
}
