import { NextRequest, NextResponse } from "next/server";
import { ensureAllWorkspacesIndexed } from "@/lib/indexer";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  ensureAllWorkspacesIndexed();

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      username: session.username,
      role: session.role,
    },
    csrfToken: session.csrfToken,
  });
}
