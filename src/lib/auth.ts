import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getAppSecret } from "./config";
import { getDb } from "./db";

export const SESSION_COOKIE_NAME = "cortex_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface AuthSession {
  userId: string;
  username: string;
  role: string;
  csrfToken: string;
  tokenHash: string;
}

const rateBuckets = new Map<string, number[]>();

/** Simple sliding-window rate limiter keyed by IP/route. */
export function checkRateLimit(
  key: string,
  maxRequests = 60,
  windowMs = 60_000,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (rateBuckets.get(key) || []).filter((ts) => ts > cutoff);
  if (recent.length >= maxRequests) {
    rateBuckets.set(key, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return { allowed: true, remaining: maxRequests - recent.length };
}

/** Hash a password with scrypt and a random 16-byte salt. */
export function hashPassword(password: string, existingSalt?: string): {
  hash: string;
  salt: string;
} {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash: derived, salt };
}

/** Verify password against stored scrypt hash using constant-time comparison. */
export function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function deriveEncryptionKey(): Buffer {
  return crypto.scryptSync(getAppSecret(), "cortex-provider-secret-salt", 32);
}

/** Encrypt a provider credential with AES-256-GCM before persisting to SQLite. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const key = deriveEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a stored AES-256-GCM provider credential on the server. */
export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const parts = payload.split(":");
  if (parts.length !== 3) return "";
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveEncryptionKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

/** Ensure at least one local admin user exists on first startup. */
export function ensureBootstrapAdmin(): void {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (row.cnt > 0) return;

  const username = (process.env.ADMIN_USERNAME?.trim() || "admin").toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim() || "cortex-admin-change-me";
  const { hash, salt } = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
  ).run(crypto.randomUUID(), username, hash, salt, Date.now());
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Issue a new authenticated session and return its raw cookie token + CSRF secret. */
export function createSession(userId: string): {
  rawToken: string;
  csrfToken: string;
  expiresAt: number;
} {
  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(hashToken(rawToken), userId, csrfToken, expiresAt, now);
  return { rawToken, csrfToken, expiresAt };
}

/** Delete a session token from SQLite on logout. */
export function revokeSession(rawToken: string): void {
  if (!rawToken) return;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(rawToken));
}

/** Resolve active session from cookie or trusted reverse-proxy OAuth header. */
export function getSessionFromRequest(req: NextRequest): AuthSession | null {
  ensureBootstrapAdmin();
  const db = getDb();

  const proxyHeader = process.env.TRUSTED_PROXY_AUTH_HEADER?.trim();
  if (proxyHeader) {
    const proxyUser = req.headers.get(proxyHeader)?.trim();
    if (proxyUser) {
      const user = db
        .prepare("SELECT id, username, role FROM users WHERE username = ?")
        .get(proxyUser.toLowerCase()) as
        | { id: string; username: string; role: string }
        | undefined;
      if (user) {
        return {
          userId: user.id,
          username: user.username,
          role: user.role,
          csrfToken: "proxy-oauth",
          tokenHash: "proxy-oauth",
        };
      }
    }
  }

  const rawCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawCookie) return null;

  const tokenHash = hashToken(rawCookie);
  const row = db
    .prepare(
      `SELECT s.token_hash, s.csrf_token, s.expires_at, u.id as user_id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        csrf_token: string;
        expires_at: number;
        user_id: string;
        username: string;
        role: string;
      }
    | undefined;

  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    csrfToken: row.csrf_token,
    tokenHash: row.token_hash,
  };
}

/** Validate authentication and CSRF header on mutating API calls. */
export function requireAuth(
  req: NextRequest,
  options?: { requireCsrf?: boolean },
): { session: AuthSession } | { error: string; status: number } {
  const session = getSessionFromRequest(req);
  if (!session) {
    return { error: "Authentication required", status: 401 };
  }
  const method = req.method.toUpperCase();
  const mutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (
    mutating &&
    options?.requireCsrf !== false &&
    session.csrfToken !== "proxy-oauth"
  ) {
    const headerToken = req.headers.get("x-csrf-token");
    if (!headerToken || headerToken !== session.csrfToken) {
      return { error: "Invalid or missing CSRF token", status: 403 };
    }
  }
  return { session };
}

/** Extract client IP key for rate limiting. */
export function getClientKey(req: NextRequest, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return `${scope}:${forwarded || realIp || "local"}`;
}

export type WorkspaceRole = "admin" | "editor" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

/** Resolve effective RBAC role ('admin' | 'editor' | 'viewer') for a user in a specific workspace. */
export function getWorkspaceRole(
  session: AuthSession,
  workspaceId: string,
): WorkspaceRole {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?",
    )
    .get(session.userId, workspaceId) as
    | { role: WorkspaceRole }
    | undefined;
  if (row?.role && ROLE_RANK[row.role]) {
    return row.role;
  }
  if (session.role === "admin") return "admin";
  if (session.role === "viewer") return "viewer";
  return "editor";
}

/** Verify the authenticated session satisfies the minimum RBAC role for a workspace. */
export function requireWorkspaceRole(
  session: AuthSession,
  workspaceId: string,
  minRole: WorkspaceRole,
): { role: WorkspaceRole } | { error: string; status: number } {
  const role = getWorkspaceRole(session, workspaceId);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return {
      error: `Insufficient workspace permissions (${minRole} required, current role: ${role})`,
      status: 403,
    };
  }
  return { role };
}
