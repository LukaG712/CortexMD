"use client";

import React, { useState } from "react";
import {
  ArrowRight,
  GitBranch,
  Lock,
  Network,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

interface LoginScreenProps {
  onSuccess: (payload: {
    user: { id: string; username: string; role: string };
    csrfToken: string;
  }) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign in failed");
        setLoading(false);
        return;
      }
      onSuccess(data);
    } catch {
      setError("Cannot reach CortexMD server.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 stripe-mesh-bg flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        {/* Left: Stripe-inspired Bento Architecture Showcase + Aesop Specimen Copy */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-300 specimen-label">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            01 // Self-Hosted AI Second Brain
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-zinc-50 leading-[1.12]">
              Plain Markdown on disk.
              <span className="block text-emerald-400">
                Grounded AI intelligence on top.
              </span>
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl leading-relaxed">
              CortexMD unifies Obsidian-grade knowledge graphs, Notion-style views,
              SM-2 flashcards, and NotebookLM citations inside a single Proxmox-ready
              SQLite &amp; Next.js server.
            </p>
          </div>

          {/* Layered Bento Previews */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800/90 bg-[#111114]/90 p-3.5 space-y-2 apple-spring hover:border-emerald-500/40">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 specimen-label">
                <span>01 / Citation RAG</span>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xs font-medium text-zinc-100">
                Exact Line Grounding
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 px-2.5 py-2 font-mono text-[10px] text-emerald-300 space-y-1">
                <div>Proxmox.md#L18-L24</div>
                <div className="text-zinc-500 font-sans">
                  Zero-key local FTS5 + 384d vectors
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-[#111114]/90 p-3.5 space-y-2 apple-spring hover:border-blue-500/40">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 specimen-label">
                <span>02 / Topology</span>
                <Network className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-xs font-medium text-zinc-100">
                Graph &amp; Pathfinder
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 px-2.5 py-2 font-mono text-[10px] text-blue-300 space-y-1">
                <div>[[Hub]] → [[ZFS]] → [[Backup]]</div>
                <div className="text-zinc-500 font-sans">
                  Shortest BFS paths &amp; semantic clusters
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-[#111114]/90 p-3.5 space-y-2 apple-spring hover:border-amber-500/40">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 specimen-label">
                <span>03 / Safe Agent</span>
                <GitBranch className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-xs font-medium text-zinc-100">
                Approval Diffs &amp; Git
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 px-2.5 py-2 font-mono text-[10px] space-y-0.5">
                <div className="text-rose-400">- outdated host note</div>
                <div className="text-emerald-400">+ [[Proxmox LXC Guide]]</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono">
              scrypt + HttpOnly CSRF
            </span>
            <span className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono">
              AES-256-GCM Secrets
            </span>
            <span className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono">
              IndexedDB Offline PWA
            </span>
            <span className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono">
              Per-Workspace RBAC
            </span>
          </div>
        </div>

        {/* Right: Apple Glass Auth Card */}
        <div className="lg:col-span-5">
          <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-800 apple-glass shadow-2xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Network className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
                  CortexMD
                </h2>
                <p className="text-xs text-zinc-400">
                  Sign in to unlock your vaults
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="login-username"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter administrator password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-semibold py-2.5 text-sm framer-press cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                {loading ? "Signing in..." : "Unlock Vaults"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3.5 space-y-2 text-xs text-zinc-400">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>First-Run Bootstrap Account</span>
              </div>
              <p className="leading-relaxed">
                Initial login uses{" "}
                <code className="text-zinc-200 bg-zinc-900 px-1 py-0.5 rounded">
                  ADMIN_USERNAME
                </code>{" "}
                (<code className="text-zinc-200">admin</code>) and{" "}
                <code className="text-zinc-200 bg-zinc-900 px-1 py-0.5 rounded">
                  ADMIN_PASSWORD
                </code>{" "}
                from your server environment. Default local password:{" "}
                <code className="text-emerald-300">cortex-admin-change-me</code>.
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 pt-0.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>Override in .env or docker-compose.yml before LAN exposure</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
