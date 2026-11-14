"use client";

import React, { useState } from "react";
import { Lock, Network, ShieldCheck, Terminal } from "lucide-react";

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
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111114] shadow-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
              CortexMD
            </h1>
            <p className="text-xs text-zinc-400">
              Self-Hosted AI Knowledge Management
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
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
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
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
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
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-semibold py-2.5 text-sm transition cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            {loading ? "Signing in..." : "Unlock Vaults"}
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
  );
}
