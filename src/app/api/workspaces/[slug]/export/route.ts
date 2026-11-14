import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getBackupsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { computeSha256 } from "@/lib/storage";

export const dynamic = "force-dynamic";

function collectAllFiles(
  rootDir: string,
  relPrefix = "",
): Array<{
  relPath: string;
  sha256: string;
  encoding: "utf8" | "base64";
  content: string;
}> {
  if (!fs.existsSync(rootDir)) return [];
  const results: Array<{
    relPath: string;
    sha256: string;
    encoding: "utf8" | "base64";
    content: string;
  }> = [];

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(rootDir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectAllFiles(full, rel));
    } else if (entry.isFile()) {
      const buf = fs.readFileSync(full);
      const isText = /\.(md|txt|json|yml|yaml|csv|canvas)$/i.test(entry.name);
      results.push({
        relPath: rel,
        sha256: computeSha256(buf),
        encoding: isText ? "utf8" : "base64",
        content: isText ? buf.toString("utf8") : buf.toString("base64"),
      });
    }
  }
  return results;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { slug } = await context.params;
  const db = getDb();
  const ws = db
    .prepare("SELECT id, slug, name, description, root_path FROM workspaces WHERE slug = ?")
    .get(slug) as
    | {
        id: string;
        slug: string;
        name: string;
        description: string;
        root_path: string;
      }
    | undefined;

  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const files = collectAllFiles(ws.root_path);
  const payload = {
    format: "cortexmd-vault-v1",
    exportedAt: new Date().toISOString(),
    workspace: {
      slug: ws.slug,
      name: ws.name,
      description: ws.description,
    },
    fileCount: files.length,
    files,
  };

  const jsonString = JSON.stringify(payload, null, 2);

  if (req.nextUrl.searchParams.get("saveSnapshot") === "true") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapPath = path.join(getBackupsDir(), `${ws.slug}-${stamp}.json`);
    fs.writeFileSync(snapPath, jsonString, "utf8");
  }

  return new NextResponse(jsonString, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ws.slug}-vault-backup.json"`,
    },
  });
}
