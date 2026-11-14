import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, revokeSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  revokeSession(rawToken);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return res;
}
