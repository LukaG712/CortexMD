import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { decryptSecret, encryptSecret } from "@/lib/auth";
import { getDb } from "@/lib/db";

const execFileAsync = promisify(execFile);

export type ProviderId =
  | "local-hybrid"
  | "gemini-cli"
  | "gemini-api"
  | "github-copilot"
  | "jetbrains-junie"
  | "ollama";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  authMode: "none" | "oauth-cli" | "api-key" | "local-http";
  billingModel: string;
  available: boolean;
  configured: boolean;
  hasSecret: boolean;
  modelName: string;
  endpointUrl: string;
  statusDetail: string;
  setupGuide: string;
}

export interface ChatTurnInput {
  systemPrompt: string;
  userPrompt: string;
  contextBlock: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

const CLI_PROBE_TTL_MS = 60_000;
let cliProbeCache: {
  ts: number;
  results: [
    { ok: boolean; output: string },
    { ok: boolean; output: string },
    { ok: boolean; output: string },
    { ok: boolean; output: string },
  ];
} | null = null;

function formatHistoryBlock(
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (!history || history.length === 0) return "";
  const trimmed = history.slice(-4).map((m) => {
    const clean = m.content.replace(/\s+/g, " ").trim().slice(0, 280);
    return `${m.role === "user" ? "User" : "Assistant"}: ${clean}`;
  });
  const block = trimmed.join("\n").slice(0, 1200);
  return block ? `<conversation_history>\n${block}\n</conversation_history>\n\n` : "";
}

export interface ProviderResponse {
  text: string;
  providerId: ProviderId;
  modelUsed: string;
  fallbackUsed?: boolean;
  warning?: string;
}

interface StoredConfig {
  provider_id: string;
  enabled: number;
  auth_mode: string;
  encrypted_secret: string;
  endpoint_url: string;
  model_name: string;
  updated_at: number;
}

function getStoredConfig(providerId: ProviderId): StoredConfig | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM provider_configs WHERE provider_id = ?")
    .get(providerId) as StoredConfig | undefined;
}

/** Save encrypted provider settings on the server (secrets are never returned to clients). */
export function saveProviderConfig(input: {
  providerId: ProviderId;
  enabled: boolean;
  authMode?: string;
  secret?: string;
  endpointUrl?: string;
  modelName?: string;
}): void {
  const db = getDb();
  const existing = getStoredConfig(input.providerId);
  const encryptedSecret =
    input.secret !== undefined
      ? input.secret.trim()
        ? encryptSecret(input.secret.trim())
        : ""
      : existing?.encrypted_secret || "";

  db.prepare(
    `INSERT INTO provider_configs (provider_id, enabled, auth_mode, encrypted_secret, endpoint_url, model_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET
       enabled = excluded.enabled,
       auth_mode = excluded.auth_mode,
       encrypted_secret = excluded.encrypted_secret,
       endpoint_url = excluded.endpoint_url,
       model_name = excluded.model_name,
       updated_at = excluded.updated_at`,
  ).run(
    input.providerId,
    input.enabled ? 1 : 0,
    input.authMode || existing?.auth_mode || "none",
    encryptedSecret,
    input.endpointUrl !== undefined ? input.endpointUrl.trim() : existing?.endpoint_url || "",
    input.modelName !== undefined ? input.modelName.trim() : existing?.model_name || "",
    Date.now(),
  );
  cliProbeCache = null;
}

async function commandExists(cmd: string, args = ["--version"]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 2500,
      windowsHide: true,
    });
    return { ok: true, output: (stdout || stderr || "").trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: (e.stdout || e.stderr || e.message || "").trim() };
  }
}

function hasGeminiCliOAuthCache(): boolean {
  const geminiDir = path.join(os.homedir(), ".gemini");
  return (
    fs.existsSync(path.join(geminiDir, "oauth_creds.json")) ||
    fs.existsSync(path.join(geminiDir, "google_accounts.json"))
  );
}

/** Probe all supported AI backends and report official auth/subscription readiness. */
export async function listProviderStatuses(): Promise<ProviderStatus[]> {
  const geminiCfg = getStoredConfig("gemini-api");
  const geminiCliCfg = getStoredConfig("gemini-cli");
  const copilotCfg = getStoredConfig("github-copilot");
  const junieCfg = getStoredConfig("jetbrains-junie");
  const ollamaCfg = getStoredConfig("ollama");

  const geminiKey =
    (geminiCfg?.encrypted_secret ? decryptSecret(geminiCfg.encrypted_secret) : "") ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";
  const copilotToken =
    (copilotCfg?.encrypted_secret ? decryptSecret(copilotCfg.encrypted_secret) : "") ||
    process.env.COPILOT_GITHUB_TOKEN?.trim() ||
    "";
  const junieKey =
    (junieCfg?.encrypted_secret ? decryptSecret(junieCfg.encrypted_secret) : "") ||
    process.env.JUNIE_API_KEY?.trim() ||
    "";

  const ollamaUrl =
    ollamaCfg?.endpoint_url || process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  const ollamaModel =
    ollamaCfg?.model_name || process.env.OLLAMA_MODEL?.trim() || "llama3.2";

  const nowTs = Date.now();
  let probes: [
    { ok: boolean; output: string },
    { ok: boolean; output: string },
    { ok: boolean; output: string },
    { ok: boolean; output: string },
  ];
  if (cliProbeCache && nowTs - cliProbeCache.ts < CLI_PROBE_TTL_MS) {
    probes = cliProbeCache.results;
  } else {
    probes = await Promise.all([
      commandExists("gemini", ["--version"]),
      commandExists("copilot", ["--version"]),
      commandExists("gh", ["auth", "status"]),
      commandExists("junie", ["--version"]),
    ]);
    cliProbeCache = { ts: nowTs, results: probes };
  }
  const [geminiBin, copilotBin, ghStatus, junieBin] = probes;

  let ollamaReachable = false;
  let ollamaModelsList: string[] = [];
  try {
    const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) {
      ollamaReachable = true;
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      ollamaModelsList = (json.models || []).map((m) => m.name);
    }
  } catch {
    ollamaReachable = false;
  }

  const geminiOAuthCached = hasGeminiCliOAuthCache();
  const copilotCliReal =
    copilotBin.ok && !copilotBin.output.includes("was not found");

  return [
    {
      id: "local-hybrid",
      name: "Cortex Local Hybrid RAG (Built-in)",
      authMode: "none",
      billingModel: "100% Free & Self-Hosted",
      available: true,
      configured: true,
      hasSecret: false,
      modelName: "fts5-bm25 + 384d-semantic",
      endpointUrl: "embedded://sqlite",
      statusDetail: "Active — zero external API calls, instant local citations & synthesis.",
      setupGuide: "Built-in default. Works offline on Proxmox with zero credentials.",
    },
    {
      id: "gemini-cli",
      name: "Google Gemini CLI (Google Account OAuth)",
      authMode: "oauth-cli",
      billingModel: "Google Account / Code Assist Free Tier / AI Pro",
      available: geminiBin.ok && (geminiOAuthCached || Boolean(geminiKey)),
      configured: Boolean(geminiCliCfg?.enabled) || (geminiBin.ok && geminiOAuthCached),
      hasSecret: geminiOAuthCached,
      modelName: geminiCliCfg?.model_name || "gemini-2.5-flash",
      endpointUrl: "cli://gemini",
      statusDetail: geminiBin.ok
        ? geminiOAuthCached
          ? "Gemini CLI detected with local Google OAuth credentials."
          : "Gemini CLI found, but Google OAuth sign-in has not been completed on this host."
        : "Gemini CLI binary not installed on host (install via `npm i -g @google/gemini-cli` and sign in with Google).",
      setupGuide:
        "Run `npx @google/gemini-cli` once in the server shell and complete `Sign in with Google` (OAuth 2.0). Never scrape consumer web cookies.",
    },
    {
      id: "gemini-api",
      name: "Google Gemini API (AI Studio)",
      authMode: "api-key",
      billingModel: "AI Studio Free Tier or Pay-As-You-Go",
      available: Boolean(geminiKey),
      configured: Boolean(geminiKey),
      hasSecret: Boolean(geminiKey),
      modelName: geminiCfg?.model_name || "gemini-2.5-flash",
      endpointUrl: "https://generativelanguage.googleapis.com",
      statusDetail: geminiKey
        ? "Server-side encrypted Gemini API key configured."
        : "Optional free-tier API key from aistudio.google.com not configured.",
      setupGuide: "Create a free-tier key in Google AI Studio and paste it below (stored AES-256-GCM encrypted on server).",
    },
    {
      id: "github-copilot",
      name: "GitHub Copilot CLI / OAuth",
      authMode: "oauth-cli",
      billingModel: "GitHub Copilot Subscription (Individual / Business)",
      available: copilotCliReal && (Boolean(copilotToken) || ghStatus.ok),
      configured: Boolean(copilotToken) || (copilotCliReal && ghStatus.ok),
      hasSecret: Boolean(copilotToken),
      modelName: copilotCfg?.model_name || "gpt-4.1",
      endpointUrl: "cli://copilot",
      statusDetail: copilotCliReal
        ? ghStatus.ok || copilotToken
          ? "Copilot CLI + GitHub OAuth session detected."
          : "Copilot CLI found, awaiting COPILOT_GITHUB_TOKEN or `gh auth login`."
        : ghStatus.ok
          ? "GitHub CLI authenticated (`gh auth status` active), but standalone Copilot CLI is not installed (`gh` reports shim only). Note: legacy `models.inference.ai.azure.com` is retired."
          : "GitHub Copilot CLI not installed on host.",
      setupGuide:
        "Install official GitHub Copilot CLI (`winget` / `npm` / `brew`) and authenticate with a Copilot-enabled GitHub OAuth token (`COPILOT_GITHUB_TOKEN`).",
    },
    {
      id: "jetbrains-junie",
      name: "JetBrains Junie CLI",
      authMode: "oauth-cli",
      billingModel: "JetBrains AI Pro/Ultimate, JUNIE_API_KEY, or BYOK",
      available: junieBin.ok && Boolean(junieKey),
      configured: junieBin.ok && Boolean(junieKey),
      hasSecret: Boolean(junieKey),
      modelName: junieCfg?.model_name || "junie-headless",
      endpointUrl: "cli://junie",
      statusDetail: junieBin.ok
        ? junieKey
          ? "Junie CLI and auth token detected."
          : "Junie CLI found; provide JUNIE_API_KEY or BYOK credentials."
        : "Junie CLI binary not installed on host.",
      setupGuide:
        "Install JetBrains Junie CLI on the host and supply `JUNIE_API_KEY` from `junie.jetbrains.com/cli` or configure BYOK.",
    },
    {
      id: "ollama",
      name: "Ollama (Local / LAN Open-Weights LLM)",
      authMode: "local-http",
      billingModel: "100% Free & Self-Hosted",
      available: ollamaReachable,
      configured: ollamaReachable || Boolean(ollamaCfg?.enabled),
      hasSecret: false,
      modelName: ollamaModelsList[0] || ollamaModel,
      endpointUrl: ollamaUrl,
      statusDetail: ollamaReachable
        ? `Ollama reachable (${ollamaModelsList.length} model(s): ${ollamaModelsList.slice(0, 3).join(", ") || "none pulled"}).`
        : `Ollama not detected at ${ollamaUrl}.`,
      setupGuide: "Run `ollama serve` locally or in a separate Proxmox LXC and pull e.g. `llama3.2` or `qwen2.5:7b`.",
    },
  ];
}

/** Execute a grounded completion against the selected external provider, or throw for clean fallback. */
export async function invokeExternalProvider(
  providerId: ProviderId,
  input: ChatTurnInput,
): Promise<ProviderResponse> {
  const historyPrefix = formatHistoryBlock(input.history);
  const fullUserPrompt = `${historyPrefix}${input.contextBlock}\n\nUser Question: ${input.userPrompt}`;

  if (providerId === "gemini-api") {
    const cfg = getStoredConfig("gemini-api");
    const apiKey =
      (cfg?.encrypted_secret ? decryptSecret(cfg.encrypted_secret) : "") ||
      process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("Gemini API key is not configured.");
    const model = cfg?.model_name || "gemini-2.5-flash";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ text: fullUserPrompt }],
            },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!res.ok) {
      throw new Error(`Gemini API HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text.trim()) throw new Error("Empty response from Gemini API.");
    return { text, providerId, modelUsed: model };
  }

  if (providerId === "ollama") {
    const cfg = getStoredConfig("ollama");
    const baseUrl = (cfg?.endpoint_url || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const model = cfg?.model_name || process.env.OLLAMA_MODEL || "llama3.2";

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: fullUserPrompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content?.trim() || "";
    if (!text) throw new Error("Empty response from Ollama.");
    return { text, providerId, modelUsed: model };
  }

  if (providerId === "gemini-cli") {
    const combinedPrompt = `${input.systemPrompt}\n\n${fullUserPrompt}`;
    const { stdout } = await execFileAsync("gemini", ["-p", combinedPrompt], {
      timeout: 35000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.trim()) throw new Error("Gemini CLI returned empty output.");
    return { text: stdout.trim(), providerId, modelUsed: "gemini-cli-oauth" };
  }

  if (providerId === "github-copilot") {
    const cfg = getStoredConfig("github-copilot");
    const token =
      (cfg?.encrypted_secret ? decryptSecret(cfg.encrypted_secret) : "") ||
      process.env.COPILOT_GITHUB_TOKEN?.trim() ||
      "";
    const env = { ...process.env };
    if (token) env.COPILOT_GITHUB_TOKEN = token;
    const combinedPrompt = `${input.systemPrompt}\n\n${fullUserPrompt}`;
    const { stdout } = await execFileAsync("copilot", ["-p", combinedPrompt], {
      timeout: 35000,
      windowsHide: true,
      env,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.trim()) throw new Error("Copilot CLI returned empty output.");
    return { text: stdout.trim(), providerId, modelUsed: "github-copilot-cli" };
  }

  if (providerId === "jetbrains-junie") {
    const cfg = getStoredConfig("jetbrains-junie");
    const token =
      (cfg?.encrypted_secret ? decryptSecret(cfg.encrypted_secret) : "") ||
      process.env.JUNIE_API_KEY?.trim() ||
      "";
    if (!token) throw new Error("Junie CLI requires JUNIE_API_KEY.");
    const combinedPrompt = `${input.systemPrompt}\n\n${fullUserPrompt}`;
    const { stdout } = await execFileAsync("junie", [`--auth=${token}`, combinedPrompt], {
      timeout: 45000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.trim()) throw new Error("Junie CLI returned empty output.");
    return { text: stdout.trim(), providerId, modelUsed: "jetbrains-junie" };
  }

  throw new Error(`Unsupported external provider: ${providerId}`);
}
