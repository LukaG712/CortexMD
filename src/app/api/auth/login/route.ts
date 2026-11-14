import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  checkRateLimit,
  createSession,
  ensureBootstrapAdmin,
  getClientKey,
  verifyPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(getClientKey(req, "login"), 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a minute." },
      { status: 429 },
    );
  }

  ensureBootstrapAdmin();

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, username, password_hash, salt, role FROM users WHERE username = ?")
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        salt: string;
        role: string;
      }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }

  ensureAllWorkspacesIndexed();

  const { rawToken, csrfToken, expiresAt } = createSession(user.id);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const isHttps = req.nextUrl.protocol === "https:" || forwardedProto === "https";

  const res = NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role },
    csrfToken,
  });
  res.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    expires: new Date(expiresAt),
  });
  return res;
}
