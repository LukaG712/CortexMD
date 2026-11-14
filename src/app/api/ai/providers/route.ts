import { NextRequest, NextResponse } from "next/server";
import {
  ProviderId,
  listProviderStatuses,
  saveProviderConfig,
} from "@/lib/ai/providers";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set<ProviderId>([
  "local-hybrid",
  "gemini-cli",
  "gemini-api",
  "github-copilot",
  "jetbrains-junie",
  "ollama",
]);

export async function GET(req: NextRequest) {
  const auth = requireAuth(req, { requireCsrf: false });
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const providers = await listProviderStatuses();
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    providerId?: ProviderId;
    enabled?: boolean;
    authMode?: string;
    secret?: string;
    endpointUrl?: string;
    modelName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body.providerId || !VALID_PROVIDERS.has(body.providerId)) {
    return NextResponse.json({ error: "Invalid providerId" }, { status: 400 });
  }

  saveProviderConfig({
    providerId: body.providerId,
    enabled: body.enabled ?? true,
    authMode: body.authMode,
    secret: body.secret,
    endpointUrl: body.endpointUrl,
    modelName: body.modelName,
  });

  const providers = await listProviderStatuses();
  return NextResponse.json({ ok: true, providers });
}
