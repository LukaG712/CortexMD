"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Globe,
  Headphones,
  History,
  MessageSquarePlus,
  Play,
  Send,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  AiConversationItem,
  AiMessageItem,
  AuditLogItem,
  BriefingResultItem,
  FolderPermissionItem,
  PendingActionItem,
  ProviderId,
  ProviderStatusItem,
  RagCitationItem,
} from "@/lib/types";

interface AiSidebarProps {
  workspaceSlug: string;
  folders: string[];
  activeNoteId?: string | null;
  providers: ProviderStatusItem[];
  conversations: AiConversationItem[];
  activeConversationId: string | null;
  messages: AiMessageItem[];
  pendingActions: PendingActionItem[];
  aclRules: FolderPermissionItem[];
  auditLogs: AuditLogItem[];
  sending: boolean;
  onSelectConversation: (id: string | null) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onSendMessage: (input: {
    prompt: string;
    providerId: ProviderId;
    scopeMode: "workspace" | "all" | "folder" | "note";
    folderPrefix?: string;
    runContradictionScan?: boolean;
  }) => Promise<void>;
  onApproveAction: (actionId: string) => Promise<void>;
  onRejectAction: (actionId: string) => Promise<void>;
  onAddAclRule: (folderPrefix: string, permission: "allow" | "deny") => Promise<void>;
  onDeleteAclRule: (ruleId: string) => Promise<void>;
  onJumpToCitation: (citation: RagCitationItem) => void;
  onIngestSource: (input: {
    title?: string;
    sourceUrl?: string;
    rawContent?: string;
    fetchUrl?: boolean;
    tags?: string[];
  }) => Promise<{
    note: { id: string; relPath: string; title: string };
    summaryBullets: string[];
  } | null>;
  onRunGardener: (providerId: ProviderId) => Promise<{
    scannedNotes: number;
    unlinkedProposed: number;
    taggingProposed: number;
    orphanBridgesProposed: number;
  } | null>;
  onGenerateBriefing: (input: {
    topic?: string;
    providerId: ProviderId;
    scopeMode: "workspace" | "all" | "folder" | "note";
    folderPrefix?: string;
    saveAsNote?: boolean;
  }) => Promise<BriefingResultItem | null>;
  onOpenNoteById: (noteId: string) => void;
}

export function AiSidebar({
  workspaceSlug,
  folders,
  activeNoteId,
  providers,
  conversations,
  activeConversationId,
  messages,
  pendingActions,
  aclRules,
  auditLogs,
  sending,
  onSelectConversation,
  onDeleteConversation,
  onSendMessage,
  onApproveAction,
  onRejectAction,
  onAddAclRule,
  onDeleteAclRule,
  onJumpToCitation,
  onIngestSource,
  onRunGardener,
  onGenerateBriefing,
  onOpenNoteById,
}: AiSidebarProps) {
  const [subTab, setSubTab] = useState<"chat" | "briefing" | "agent" | "security">("chat");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState<ProviderId>("local-hybrid");
  const [scopeMode, setScopeMode] = useState<
    "workspace" | "all" | "folder" | "note"
  >("workspace");
  const [folderPrefix, setFolderPrefix] = useState("");
  const [newAclFolder, setNewAclFolder] = useState("");
  const [newAclPerm, setNewAclPerm] = useState<"deny" | "allow">("deny");

  // Source Ingest Clipper state
  const [clipperOpen, setClipperOpen] = useState(false);
  const [clipTitle, setClipTitle] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [clipRaw, setClipRaw] = useState("");
  const [clipFetchUrl, setClipFetchUrl] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [lastClipped, setLastClipped] = useState<{
    note: { id: string; relPath: string; title: string };
    summaryBullets: string[];
  } | null>(null);

  // Vault Gardener state
  const [gardening, setGardening] = useState(false);
  const [gardenerStats, setGardenerStats] = useState<{
    scannedNotes: number;
    unlinkedProposed: number;
    taggingProposed: number;
    orphanBridgesProposed: number;
  } | null>(null);

  // Briefing & Audio Overview TTS state
  const [briefTopic, setBriefTopic] = useState("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefResult, setBriefResult] = useState<BriefingResultItem | null>(null);
  const [briefView, setBriefView] = useState<"audio" | "guide" | "faq">("audio");
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [activeAudioIdx, setActiveAudioIdx] = useState<number | null>(null);
  const ttsCancelRef = useRef(false);

  // Item 19: Hover Citation Preview
  const [hoveredCitation, setHoveredCitation] = useState<RagCitationItem | null>(null);

  const pendingOnly = pendingActions.filter((a) => a.status === "pending");

  function stopAudioBriefing() {
    ttsCancelRef.current = true;
    setTtsPlaying(false);
    setActiveAudioIdx(null);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function playAudioBriefing() {
    if (!briefResult || briefResult.audioSegments.length === 0) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    ttsCancelRef.current = false;
    setTtsPlaying(true);

    const segments = briefResult.audioSegments;
    const speakNext = (idx: number) => {
      if (ttsCancelRef.current || idx >= segments.length) {
        setTtsPlaying(false);
        setActiveAudioIdx(null);
        return;
      }
      setActiveAudioIdx(idx);
      const seg = segments[idx];
      const utter = new SpeechSynthesisUtterance(`${seg.speaker} says: ${seg.text}`);
      utter.pitch = seg.speaker === "Host B" ? 1.12 : 0.96;
      utter.rate = 1.02;
      utter.onend = () => speakNext(idx + 1);
      utter.onerror = () => speakNext(idx + 1);
      window.speechSynthesis.speak(utter);
    };
    speakNext(0);
  }

  async function handleClipSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (clipping) return;
    if (!clipRaw.trim() && !(clipFetchUrl && clipUrl.trim())) return;
    setClipping(true);
    try {
      const res = await onIngestSource({
        title: clipTitle.trim() || undefined,
        sourceUrl: clipUrl.trim() || undefined,
        rawContent: clipRaw.trim() || undefined,
        fetchUrl: clipFetchUrl,
      });
      if (res) {
        setLastClipped(res);
        setClipTitle("");
        setClipUrl("");
        setClipRaw("");
      }
    } finally {
      setClipping(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    const text = prompt.trim();
    setPrompt("");
    await onSendMessage({
      prompt: text,
      providerId,
      scopeMode,
      folderPrefix: scopeMode === "folder" ? folderPrefix : undefined,
    });
  }

  return (
    <aside className="flex flex-col h-full bg-[#0f0f13] border-l border-zinc-800/90 text-xs">
      {/* Studio Sub-tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 bg-[#121217]">
        <div className="flex items-center gap-1.5 font-semibold text-zinc-100">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>AI Studio</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-zinc-950 border border-zinc-800 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setSubTab("chat")}
            className={`px-2 py-1 rounded-md cursor-pointer ${
              subTab === "chat"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setSubTab("briefing")}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer ${
              subTab === "briefing"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Headphones className="w-3 h-3 text-emerald-400" />
            Brief
          </button>
          <button
            type="button"
            onClick={() => setSubTab("agent")}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer ${
              subTab === "agent"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Agent
            {pendingOnly.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">
                {pendingOnly.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSubTab("security")}
            className={`px-2 py-1 rounded-md cursor-pointer ${
              subTab === "security"
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            ACLs
          </button>
        </div>
      </div>

      {subTab === "chat" && (
        <>
          {/* Provider + Scope + Conversation Selector */}
          <div className="p-3 border-b border-zinc-800/70 space-y-2 bg-[#0c0c10]">
            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label="AI Provider"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value as ProviderId)}
                className="w-full min-w-0 truncate rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                {providers
                  .filter((p) => p.id === "local-hybrid" || p.id === "ollama")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id === "local-hybrid" ? "Embedded Offline" : p.available ? "Local Ready" : "Localhost"})
                    </option>
                  ))}
              </select>

              <select
                aria-label="Context Scope"
                value={scopeMode}
                onChange={(e) =>
                  setScopeMode(
                    e.target.value as "workspace" | "all" | "folder" | "note",
                  )
                }
                className="w-full min-w-0 truncate rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="workspace">Vault: {workspaceSlug}</option>
                <option value="all">All Workspaces</option>
                <option value="folder">Specific Folder</option>
                {activeNoteId && <option value="note">Active Note Only</option>}
              </select>
            </div>

            {scopeMode === "folder" && (
              <select
                value={folderPrefix}
                onChange={(e) => setFolderPrefix(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value="">Select folder...</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}/
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Conversation History"
                value={activeConversationId || ""}
                onChange={(e) => onSelectConversation(e.target.value || null)}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400"
              >
                <option value="">New Conversation</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Clip Web URL or Source Text"
                onClick={() => setClipperOpen((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] cursor-pointer ${
                  clipperOpen
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                Clip
              </button>
              <button
                type="button"
                title="Start New Conversation"
                onClick={() => onSelectConversation(null)}
                className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
              </button>
              {activeConversationId && (
                <button
                  type="button"
                  title="Delete Conversation"
                  onClick={() => onDeleteConversation(activeConversationId)}
                  className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {clipperOpen && (
              <form
                onSubmit={handleClipSubmit}
                className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-200">
                  <span>Source / Web Ingest → Sources/</span>
                  <button
                    type="button"
                    onClick={() => setClipperOpen(false)}
                    className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
                <input
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  placeholder="Optional title (inferred if omitted)"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={clipUrl}
                    onChange={(e) => setClipUrl(e.target.value)}
                    placeholder="https://... (public URL)"
                    className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600"
                  />
                  <label className="inline-flex items-center gap-1 text-[10px] text-zinc-400 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clipFetchUrl}
                      onChange={(e) => setClipFetchUrl(e.target.checked)}
                      className="rounded border-zinc-700"
                    />
                    Fetch
                  </label>
                </div>
                <textarea
                  rows={3}
                  value={clipRaw}
                  onChange={(e) => setClipRaw(e.target.value)}
                  placeholder="Or paste HTML / article / raw text to convert into clean Markdown with takeaways..."
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600"
                />
                <button
                  type="submit"
                  disabled={clipping || (!clipRaw.trim() && !(clipFetchUrl && clipUrl.trim()))}
                  className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 py-1.5 text-[11px] font-semibold text-zinc-950 cursor-pointer"
                >
                  {clipping ? "Clipping & Indexing..." : "Clip into Vault"}
                </button>
                {lastClipped && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-emerald-300 truncate">
                        {lastClipped.note.relPath}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenNoteById(lastClipped.note.id)}
                        className="inline-flex items-center gap-1 text-emerald-200 hover:underline shrink-0 cursor-pointer"
                      >
                        Open
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                    {lastClipped.summaryBullets.slice(0, 2).map((b, idx) => (
                      <div key={idx} className="text-[10px] text-zinc-300 line-clamp-2">
                        • {b}
                      </div>
                    ))}
                  </div>
                )}
              </form>
            )}
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2.5 text-zinc-400">
                <div className="flex items-center gap-2 text-zinc-200 font-medium">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <span>NotebookLM-Grade Grounded Assistant</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Ask questions across your vaults with line-level citations, scan for contradicting specs, or trigger approval-gated agent edits.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onSendMessage({
                        prompt: "Analyze contradictions and duplicate notes in this workspace",
                        providerId,
                        scopeMode,
                        runContradictionScan: true,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 cursor-pointer"
                  >
                    <FileSearch className="w-3 h-3 text-amber-400" />
                    Scan Contradictions
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSendMessage({
                        prompt: "Auto-link notes related to the active note",
                        providerId,
                        scopeMode: "workspace",
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 cursor-pointer"
                  >
                    Auto-Link Active Note
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSendMessage({
                        prompt: "Summarize key findings into a new Research note",
                        providerId,
                        scopeMode,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 cursor-pointer"
                  >
                    Draft Research Summary Note
                  </button>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl p-3 space-y-2 ${
                  m.role === "user"
                    ? "bg-blue-500/10 border border-blue-500/25 ml-4 text-zinc-100"
                    : "bg-zinc-950/80 border border-zinc-800/80 mr-2 text-zinc-200"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {m.role === "user" ? "You" : "CortexMD AI"}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed text-xs">
                  {m.content}
                </div>

                {m.citations && m.citations.length > 0 && (
                  <div className="pt-1.5 border-t border-zinc-800/70 space-y-1 relative">
                    <div className="text-[10px] text-zinc-500 font-medium">
                      Grounded Sources ({m.citations.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.citations.slice(0, 6).map((c, idx) => (
                        <button
                          key={`${c.noteId}-${c.startLine}-${idx}`}
                          type="button"
                          onClick={() => onJumpToCitation(c)}
                          onMouseEnter={() => setHoveredCitation(c)}
                          onMouseLeave={() => setHoveredCitation(null)}
                          title={`${c.relPath} (L${c.startLine}-L${c.endLine})`}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 cursor-pointer"
                        >
                          <span className="font-medium truncate max-w-[120px]">
                            {c.title}
                          </span>
                          <span className="font-mono text-emerald-400/80">
                            L{c.startLine}-L{c.endLine}
                          </span>
                        </button>
                      ))}
                    </div>
                    {hoveredCitation &&
                      m.citations.some(
                        (c) =>
                          c.noteId === hoveredCitation.noteId &&
                          c.startLine === hoveredCitation.startLine,
                      ) && (
                        <div className="mt-1.5 rounded-lg border border-emerald-500/35 bg-zinc-950/95 p-2 text-[11px] shadow-xl space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-emerald-300 truncate">
                              {hoveredCitation.title}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-500">
                              L{hoveredCitation.startLine}-L{hoveredCitation.endLine}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 truncate">
                            {hoveredCitation.relPath}
                          </div>
                          <p className="text-[10px] text-zinc-300 line-clamp-3 leading-relaxed">
                            {hoveredCitation.snippet}
                          </p>
                        </div>
                      )}
                  </div>
                )}

                {m.toolProposals && m.toolProposals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubTab("agent")}
                    className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 text-left cursor-pointer"
                  >
                    Open {m.toolProposals.length} Pending Diff Proposal(s) in Agent Queue →
                  </button>
                )}
              </div>
            ))}

            {sending && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-zinc-400 animate-pulse">
                Retrieving grounded vault chunks &amp; synthesizing...
              </div>
            )}
          </div>

          {/* Chat Composer */}
          <form
            onSubmit={handleSubmit}
            className="p-3 border-t border-zinc-800/80 bg-[#0c0c10] space-y-2"
          >
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Ask across notes or instruct the agent (e.g. 'Auto-link active note')..."
                className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={sending || !prompt.trim()}
                className="px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-zinc-950 font-semibold flex items-center justify-center cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </>
      )}

      {subTab === "briefing" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-3 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Headphones className="w-4 h-4 text-emerald-400" />
              <span>Study Guide, FAQ &amp; Audio Briefing</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Synthesize ACL-permitted vault notes into a grounded Study Guide, FAQ, and two-host spoken overview.
            </p>
            <input
              value={briefTopic}
              onChange={(e) => setBriefTopic(e.target.value)}
              placeholder="Optional focus topic (e.g. Proxmox backups, Docker networking)..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-600"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={briefLoading}
                onClick={async () => {
                  setBriefLoading(true);
                  stopAudioBriefing();
                  try {
                    const res = await onGenerateBriefing({
                      topic: briefTopic.trim() || undefined,
                      providerId,
                      scopeMode,
                      folderPrefix: scopeMode === "folder" ? folderPrefix : undefined,
                      saveAsNote: false,
                    });
                    if (res) setBriefResult(res);
                  } finally {
                    setBriefLoading(false);
                  }
                }}
                className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 py-1.5 text-[11px] font-semibold text-zinc-950 cursor-pointer"
              >
                {briefLoading ? "Synthesizing..." : "Generate Briefing"}
              </button>
              <button
                type="button"
                disabled={briefLoading}
                onClick={async () => {
                  setBriefLoading(true);
                  stopAudioBriefing();
                  try {
                    const res = await onGenerateBriefing({
                      topic: briefTopic.trim() || undefined,
                      providerId,
                      scopeMode,
                      folderPrefix: scopeMode === "folder" ? folderPrefix : undefined,
                      saveAsNote: true,
                    });
                    if (res) setBriefResult(res);
                  } finally {
                    setBriefLoading(false);
                  }
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 cursor-pointer"
              >
                Save Note
              </button>
            </div>
          </div>

          {briefResult && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-zinc-950 border border-zinc-800 p-0.5 text-[10px]">
                  {(
                    [
                      ["audio", "Audio"],
                      ["guide", "Study Guide"],
                      ["faq", "FAQ"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setBriefView(k)}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        briefView === k
                          ? "bg-zinc-800 text-zinc-100 font-medium"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {briefView === "audio" && (
                  <button
                    type="button"
                    onClick={() =>
                      ttsPlaying ? stopAudioBriefing() : playAudioBriefing()
                    }
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      ttsPlaying
                        ? "bg-rose-500/20 border border-rose-500/40 text-rose-300"
                        : "bg-blue-600 hover:bg-blue-500 text-white"
                    }`}
                  >
                    {ttsPlaying ? (
                      <>
                        <Square className="w-3 h-3" />
                        Stop TTS
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3" />
                        Play Audio
                      </>
                    )}
                  </button>
                )}
              </div>

              {briefResult.savedRelPath && briefResult.savedNoteId && (
                <button
                  type="button"
                  onClick={() => onOpenNoteById(briefResult.savedNoteId!)}
                  className="w-full flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 cursor-pointer"
                >
                  <span className="truncate font-mono">
                    Saved: {briefResult.savedRelPath}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}

              {briefView === "audio" && (
                <div className="space-y-1.5">
                  {briefResult.audioSegments.map((seg, idx) => (
                    <div
                      key={idx}
                      className={`rounded-lg border p-2.5 text-[11px] leading-relaxed ${
                        activeAudioIdx === idx
                          ? "border-emerald-500/60 bg-emerald-500/10 text-zinc-100"
                          : "border-zinc-800 bg-zinc-950/70 text-zinc-300"
                      }`}
                    >
                      <span
                        className={`font-semibold mr-1.5 ${
                          seg.speaker === "Host A"
                            ? "text-emerald-400"
                            : "text-blue-400"
                        }`}
                      >
                        {seg.speaker}:
                      </span>
                      {seg.text}
                    </div>
                  ))}
                </div>
              )}

              {briefView === "guide" && (
                <pre className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-[11px] text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed">
                  {briefResult.studyGuideMarkdown}
                </pre>
              )}

              {briefView === "faq" && (
                <pre className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-[11px] text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed">
                  {briefResult.faqMarkdown}
                </pre>
              )}

              {briefResult.citations.length > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="text-[10px] text-zinc-500 font-medium">
                    Briefing Sources ({briefResult.citations.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {briefResult.citations.slice(0, 6).map((c, idx) => (
                      <button
                        key={`${c.noteId}-${idx}`}
                        type="button"
                        onClick={() => onJumpToCitation(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 cursor-pointer"
                      >
                        <span className="truncate max-w-[120px]">{c.title}</span>
                        <span className="font-mono text-emerald-400/80">
                          L{c.startLine}-L{c.endLine}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === "agent" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2 text-[11px] text-zinc-400">
            <div>
              All AI file creations, edits, reorganizations, and metadata updates are{" "}
              <span className="text-zinc-200 font-medium">approval-gated</span> with full diff previews before touching disk.
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={gardening}
                onClick={async () => {
                  setGardening(true);
                  try {
                    const stats = await onRunGardener(providerId);
                    if (stats) setGardenerStats(stats);
                  } finally {
                    setGardening(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {gardening ? "Scanning Vault..." : "Run Vault Gardener"}
              </button>
              {gardenerStats && (
                <span className="text-[10px] text-zinc-500">
                  {gardenerStats.scannedNotes} scanned •{" "}
                  {gardenerStats.unlinkedProposed +
                    gardenerStats.taggingProposed +
                    gardenerStats.orphanBridgesProposed}{" "}
                  diffs
                </span>
              )}
            </div>
          </div>

          {pendingActions.length === 0 ? (
            <p className="text-zinc-500 text-center py-8">
              No pending or recent agent actions in this workspace.
            </p>
          ) : (
            pendingActions.map((act) => (
              <div
                key={act.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-emerald-400">
                    {act.toolName}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                      act.status === "pending"
                        ? "bg-amber-500/20 text-amber-300"
                        : act.status === "approved"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {act.status}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-zinc-400 truncate">
                  Target: {String(act.args.relPath || "(new)")}
                </div>

                <pre className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-[#09090b] p-2 font-mono text-[10px] whitespace-pre-wrap">
                  {act.previewDiff.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.startsWith("+")
                          ? "text-emerald-400"
                          : line.startsWith("-")
                            ? "text-rose-400"
                            : "text-zinc-400"
                      }
                    >
                      {line}
                    </div>
                  ))}
                </pre>

                {act.status === "pending" && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onApproveAction(act.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold py-1.5 text-[11px] cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve &amp; Write
                    </button>
                    <button
                      type="button"
                      onClick={() => onRejectAction(act.id)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 px-3 py-1.5 text-[11px] cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {subTab === "security" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-zinc-200 font-semibold">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>AI Folder Access Rules (ACL)</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Folders marked <code className="text-rose-300">deny</code> are blocked from RAG indexing retrieval and agent file mutations.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newAclFolder.trim()) return;
                await onAddAclRule(newAclFolder.trim(), newAclPerm);
                setNewAclFolder("");
              }}
              className="flex gap-1.5"
            >
              <input
                value={newAclFolder}
                onChange={(e) => setNewAclFolder(e.target.value)}
                placeholder="Folder e.g. Private"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-100"
              />
              <select
                value={newAclPerm}
                onChange={(e) => setNewAclPerm(e.target.value as "deny" | "allow")}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value="deny">Deny</option>
                <option value="allow">Allow</option>
              </select>
              <button
                type="submit"
                className="px-2.5 rounded-lg bg-emerald-600 text-zinc-950 font-semibold text-[11px] cursor-pointer"
              >
                Save
              </button>
            </form>

            <div className="space-y-1.5">
              {aclRules.length === 0 ? (
                <div className="text-[11px] text-zinc-500">
                  No folder restrictions configured in this workspace.
                </div>
              ) : (
                aclRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          rule.permission === "deny"
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {rule.permission}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-200 truncate">
                        {rule.folderPrefix}/
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteAclRule(rule.id)}
                      className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center gap-1.5 text-zinc-200 font-semibold">
              <History className="w-4 h-4 text-blue-400" />
              <span>AI Audit Log</span>
            </div>
            <div className="space-y-1.5">
              {auditLogs.slice(0, 15).map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="font-mono">{log.toolName}</span>
                    <span className="text-[10px] text-zinc-500">
                      {log.actionStatus}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {log.providerId} • {log.targetPath}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
