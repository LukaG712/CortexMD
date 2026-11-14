import crypto from "node:crypto";
import { getDb } from "@/lib/db";

export interface FolderPermissionRule {
  id: string;
  workspaceId: string;
  folderPrefix: string;
  permission: "allow" | "deny";
  updatedAt: number;
}

function normalizePrefix(prefix: string): string {
  return prefix.replaceAll("\\", "/").trim().replace(/^\/+|\/+$/g, "");
}

/** List configured AI folder ACL rules for a workspace. */
export function listFolderPermissions(workspaceId: string): FolderPermissionRule[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, workspace_id, folder_prefix, permission, updated_at
       FROM ai_folder_permissions
       WHERE workspace_id = ?
       ORDER BY LENGTH(folder_prefix) DESC, folder_prefix ASC`,
    )
    .all(workspaceId) as Array<{
    id: string;
    workspace_id: string;
    folder_prefix: string;
    permission: "allow" | "deny";
    updated_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    folderPrefix: r.folder_prefix,
    permission: r.permission,
    updatedAt: r.updated_at,
  }));
}

/** Upsert a folder permission rule (`allow` or `deny`) for AI read/write access. */
export function setFolderPermission(
  workspaceId: string,
  folderPrefix: string,
  permission: "allow" | "deny",
): FolderPermissionRule {
  const db = getDb();
  const cleanPrefix = normalizePrefix(folderPrefix);
  const now = Date.now();
  const existing = db
    .prepare(
      "SELECT id FROM ai_folder_permissions WHERE workspace_id = ? AND LOWER(folder_prefix) = LOWER(?)",
    )
    .get(workspaceId, cleanPrefix) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE ai_folder_permissions SET folder_prefix = ?, permission = ?, updated_at = ? WHERE id = ?",
    ).run(cleanPrefix, permission, now, existing.id);
    return {
      id: existing.id,
      workspaceId,
      folderPrefix: cleanPrefix,
      permission,
      updatedAt: now,
    };
  }

  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO ai_folder_permissions (id, workspace_id, folder_prefix, permission, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, workspaceId, cleanPrefix, permission, now);
  return {
    id,
    workspaceId,
    folderPrefix: cleanPrefix,
    permission,
    updatedAt: now,
  };
}

/** Delete an AI folder ACL rule by ID. */
export function deleteFolderPermission(workspaceId: string, ruleId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM ai_folder_permissions WHERE id = ? AND workspace_id = ?").run(
    ruleId,
    workspaceId,
  );
}

/**
 * Check if a relative note path is allowed for AI read/write operations.
 * Most specific matching prefix wins; `deny` wins on tie. Default is `allow`.
 */
export function isPathPermittedForAi(workspaceId: string, relPath: string): boolean {
  const cleanPath = relPath.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
  const rules = listFolderPermissions(workspaceId);
  if (rules.length === 0) return true;

  let bestLen = -1;
  let decision: "allow" | "deny" = "allow";

  for (const rule of rules) {
    const prefix = rule.folderPrefix.toLowerCase();
    const matches =
      prefix === "" ||
      cleanPath === prefix ||
      cleanPath.startsWith(`${prefix}/`);
    if (!matches) continue;

    if (prefix.length > bestLen) {
      bestLen = prefix.length;
      decision = rule.permission;
    } else if (prefix.length === bestLen && rule.permission === "deny") {
      decision = "deny";
    }
  }

  return decision === "allow";
}
