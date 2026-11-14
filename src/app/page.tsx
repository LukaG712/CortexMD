"use client";

import {
  cacheNoteOffline,
  cacheNotesListOffline,
  getCachedNoteOffline,
  getCachedNotesListOffline,
} from "@/lib/offline-db";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  Bookmark,
  Brain,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  FilePlus2,
  FileText,
  Flame,
  Folder,
  FolderPlus,
  Home,
  Kanban,
  LayoutGrid,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AiSidebar } from "@/components/AiSidebar";
import { CalendarHeatmapView } from "@/components/CalendarHeatmapView";
import { CommandPalette } from "@/components/CommandPalette";
import { FlashcardReviewView } from "@/components/FlashcardReviewView";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { LoginScreen } from "@/components/LoginScreen";
import { MarkdownWorkspace } from "@/components/MarkdownWorkspace";
import { SpatialCanvasView } from "@/components/SpatialCanvasView";
import { VaultHomeDashboard } from "@/components/VaultHomeDashboard";
import {
  ImportVaultModal,
  KanbanTasksView,
  NewNoteModal,
  NewWorkspaceModal,
  SettingsModal,
} from "@/components/WorkspaceModals";
import {
  AiConversationItem,
  AiMessageItem,
  AuditLogItem,
  BacklinkItem,
  ConflictState,
  CortexQueryResultItem,
  FolderPermissionItem,
  GraphData,
  HeadingItem,
  NoteDetail,
  NoteSummary,
  NoteTemplateItem,
  OfflineQueuedEdit,
  OutgoingLinkItem,
  PendingActionItem,
  ProviderId,
  ProviderStatusItem,
  RagCitationItem,
  RelatedNoteItem,
  SavedSearchItem,
  TaskItem,
  TransclusionEntry,
  UnlinkedMentionItem,
  VersionItem,
  WorkspaceItem,
} from "@/lib/types";

const OFFLINE_QUEUE_KEY = "cortexmd_offline_queue_v1";
const NOTE_CACHE_KEY = "cortexmd_note_cache_v1";

export default function CortexMdPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    username: string;
    role: string;
  } | null>(null);
  const [csrfToken, setCsrfToken] = useState("");

  // Layout state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mainView, setMainView] = useState<
    "home" | "notes" | "graph" | "kanban" | "canvas" | "calendar" | "cards"
  >("notes");
  const [theme, setTheme] = useState<"obsidian" | "paper">("obsidian");
  const [zenMode, setZenMode] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInitialQuery, setCmdInitialQuery] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearchItem[]>([]);
  const [newNoteModalOpen, setNewNoteModalOpen] = useState(false);
  const [newWorkspaceModalOpen, setNewWorkspaceModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState<
    "all" | "favorites" | "pinned" | "orphans" | "trash"
  >("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // Workspace & Note data
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeWorkspaceSlug, setActiveWorkspaceSlug] = useState("personal");
  const [templates, setTemplates] = useState<NoteTemplateItem[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // Active Note & Editor state
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: string; title: string; relPath: string }>
  >([]);
  const [activeNote, setActiveNote] = useState<NoteDetail | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [outgoingLinks, setOutgoingLinks] = useState<OutgoingLinkItem[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [unlinkedMentions, setUnlinkedMentions] = useState<UnlinkedMentionItem[]>([]);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNoteItem[]>([]);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [localGraph, setLocalGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [transclusions, setTransclusions] = useState<Record<string, TransclusionEntry>>({});
  const [queryResults, setQueryResults] = useState<Record<string, CortexQueryResultItem>>({});
  const [highlightLines, setHighlightLines] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // Sync / Offline state
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedEdit[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // AI Studio state
  const [providers, setProviders] = useState<ProviderStatusItem[]>([]);
  const [conversations, setConversations] = useState<AiConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<AiMessageItem[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingActionItem[]>([]);
  const [aclRules, setAclRules] = useState<FolderPermissionItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [aiSending, setAiSending] = useState(false);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  // Hydrate offline queue and online listeners
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    try {
      const savedQueue = JSON.parse(
        localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]",
      ) as OfflineQueuedEdit[];
      setOfflineQueue(savedQueue);
    } catch {
      setOfflineQueue([]);
    }
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Collapse sidebars cleanly on mobile initial render
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setRightOpen(false);
      if (window.innerWidth < 768) setLeftOpen(false);
    }
  }, []);

  // Hydrate and sync Obsidian / Warm Paper theme
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cortexmd_theme_v1");
      const next = saved === "paper" ? "paper" : "obsidian";
      setTheme(next);
      document.documentElement.dataset.theme = next;
    } catch {
      document.documentElement.dataset.theme = "obsidian";
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "obsidian" ? "paper" : "obsidian";
      try {
        window.localStorage.setItem("cortexmd_theme_v1", next);
      } catch {
        // ignore storage errors
      }
      document.documentElement.dataset.theme = next;
      return next;
    });
  }, []);

  const streakDays = useMemo(() => {
    const activeNotesList = notes.filter((n) => !n.isTrashed);
    if (activeNotesList.length === 0) return 0;
    const toLocalDayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
    const activeDays = new Set<string>();
    for (const n of activeNotesList) {
      if (n.updatedAt) {
        activeDays.add(toLocalDayKey(new Date(n.updatedAt)));
      }
      const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(n.relPath);
      if (
        dateMatch &&
        (n.objectType === "journal" || n.relPath.toLowerCase().includes("journal"))
      ) {
        activeDays.add(dateMatch[1]);
      }
    }
    const cursor = new Date();
    if (!activeDays.has(toLocalDayKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!activeDays.has(toLocalDayKey(cursor))) {
        return 1;
      }
    }
    let streak = 0;
    while (activeDays.has(toLocalDayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return Math.max(1, streak);
  }, [notes]);

  // Global Ctrl+K command palette shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (
        e.key === "Escape" &&
        zenMode &&
        !cmdOpen &&
        !newNoteModalOpen &&
        !newWorkspaceModalOpen &&
        !importModalOpen &&
        !settingsModalOpen
      ) {
        setZenMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    zenMode,
    cmdOpen,
    newNoteModalOpen,
    newWorkspaceModalOpen,
    importModalOpen,
    settingsModalOpen,
  ]);

  // Initial auth check
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setUser(data.user);
          setCsrfToken(data.csrfToken || "");
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const loadWorkspaceData = useCallback(
    async (slug: string) => {
      try {
        const [wsRes, notesRes] = await Promise.all([
          fetch(`/api/workspaces?slug=${encodeURIComponent(slug)}`),
          fetch(
            `/api/notes?workspaceSlug=${encodeURIComponent(slug)}&includeTrashed=true&view=graph`,
          ),
        ]);
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          setWorkspaces(wsData.workspaces || []);
          setTemplates(wsData.templates || []);
        }
        if (notesRes.ok) {
          const nData = await notesRes.json();
          const fetchedNotes = nData.notes || [];
          setNotes(fetchedNotes);
          setFolders(nData.folders || []);
          setTags(nData.tags || []);
          setOrphanIds(nData.orphanIds || []);
          if (nData.graph) setGraph(nData.graph);
          cacheNotesListOffline(slug, fetchedNotes).catch(() => {});
        } else {
          const cached = await getCachedNotesListOffline(slug);
          if (cached.length > 0) setNotes(cached);
        }
        const [taskRes, savedRes] = await Promise.all([
          fetch(`/api/notes?workspaceSlug=${encodeURIComponent(slug)}&view=tasks`),
          fetch(`/api/search/saved?workspaceSlug=${encodeURIComponent(slug)}`),
        ]);
        if (taskRes.ok) {
          const tData = await taskRes.json();
          setTasks(tData.tasks || []);
        }
        if (savedRes.ok) {
          const sData = await savedRes.json();
          setSavedSearches(sData.searches || []);
        }
      } catch {
        const cached = await getCachedNotesListOffline(slug);
        if (cached.length > 0) {
          setNotes(cached);
          notify("Offline mode: showing cached notes list");
        }
      }
    },
    [notify],
  );

  // Handle PWA Web Share Target quick-capture query parameters (?capture_title=...&capture_text=...&capture_url=...)
  useEffect(() => {
    if (typeof window === "undefined" || !user || !csrfToken) return;
    const url = new URL(window.location.href);
    const title = url.searchParams.get("capture_title") || "";
    const text = url.searchParams.get("capture_text") || "";
    const shareUrl = url.searchParams.get("capture_url") || "";
    if (!title && !text && !shareUrl) return;

    url.searchParams.delete("capture_title");
    url.searchParams.delete("capture_text");
    url.searchParams.delete("capture_url");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

    void (async () => {
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            workspaceSlug: activeWorkspaceSlug,
            title,
            text,
            url: shareUrl,
          }),
        });
        if (res.ok) {
          await loadWorkspaceData(activeWorkspaceSlug);
          notify("Captured shared content into Inbox");
        } else {
          const err = await res.json().catch(() => ({}));
          notify(err.error || "Quick capture failed");
        }
      } catch {
        notify("Offline: could not submit quick capture");
      }
    })();
  }, [user, csrfToken, activeWorkspaceSlug, loadWorkspaceData, notify]);

  const loadAiData = useCallback(
    async (slug: string, convId?: string | null) => {
      const [provRes, convRes, actRes, aclRes, audRes] = await Promise.all([
        fetch("/api/ai/providers"),
        fetch(
          `/api/ai/conversations?workspaceSlug=${encodeURIComponent(slug)}${convId ? `&conversationId=${encodeURIComponent(convId)}` : ""}`,
        ),
        fetch(`/api/ai/actions?workspaceSlug=${encodeURIComponent(slug)}`),
        fetch(`/api/ai/permissions?workspaceSlug=${encodeURIComponent(slug)}`),
        fetch(`/api/ai/audit?workspaceSlug=${encodeURIComponent(slug)}`),
      ]);
      if (provRes.ok) {
        const d = await provRes.json();
        setProviders(d.providers || []);
      }
      if (convRes.ok) {
        const d = await convRes.json();
        setConversations(d.conversations || []);
        if (convId === null) {
          setActiveConversationId(null);
          setMessages([]);
        } else {
          setActiveConversationId(d.activeConversationId || null);
          setMessages(d.messages || []);
        }
      }
      if (actRes.ok) {
        const d = await actRes.json();
        setPendingActions(d.actions || []);
      }
      if (aclRes.ok) {
        const d = await aclRes.json();
        setAclRules(d.rules || []);
      }
      if (audRes.ok) {
        const d = await audRes.json();
        setAuditLogs(d.logs || []);
      }
    },
    [],
  );

  const openNote = useCallback(
    async (
      noteId: string,
      opts?: { workspaceSlug?: string; line?: number; endLine?: number },
    ) => {
      const slug = opts?.workspaceSlug || activeWorkspaceSlug;
      if (opts?.workspaceSlug && opts.workspaceSlug !== activeWorkspaceSlug) {
        setActiveWorkspaceSlug(opts.workspaceSlug);
      }

      try {
        const res = await fetch(
          `/api/notes?workspaceSlug=${encodeURIComponent(slug)}&noteId=${encodeURIComponent(noteId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const detail = data.note as NoteDetail;
        setActiveNote(detail);
        setDraftContent(detail.body);
        setDirty(false);
        setHeadings(data.headings || []);
        setOutgoingLinks(data.outgoingLinks || []);
        setBacklinks(data.backlinks || []);
        setUnlinkedMentions(data.unlinkedMentions || []);
        setRelatedNotes(data.relatedNotes || []);
        setVersions(data.versions || []);
        setLocalGraph(data.localGraph || { nodes: [], edges: [] });
        setTransclusions(data.transclusions || {});
        setQueryResults(data.queryResults || {});
        setMainView("notes");

        if (opts?.line) {
          setHighlightLines({
            start: opts.line,
            end: opts.endLine || opts.line + 4,
          });
        } else {
          setHighlightLines(null);
        }

        setOpenTabs((prev) => {
          if (prev.some((t) => t.id === detail.id)) return prev;
          return [
            ...prev.slice(-7),
            { id: detail.id, title: detail.title, relPath: detail.relPath },
          ];
        });

        // Cache locally for offline PWA reads (IndexedDB + localStorage)
        cacheNoteOffline(detail).catch(() => {});
        try {
          const cache = JSON.parse(
            localStorage.getItem(NOTE_CACHE_KEY) || "{}",
          ) as Record<string, NoteDetail>;
          cache[detail.id] = detail;
          localStorage.setItem(NOTE_CACHE_KEY, JSON.stringify(cache));
        } catch {
          // ignore quota error
        }
      } catch {
        // Offline cache fallback (IndexedDB first, then localStorage)
        try {
          let cached = await getCachedNoteOffline(noteId);
          if (!cached) {
            const cache = JSON.parse(
              localStorage.getItem(NOTE_CACHE_KEY) || "{}",
            ) as Record<string, NoteDetail>;
            cached = cache[noteId] || null;
          }
          if (cached) {
            setActiveNote(cached);
            setDraftContent(cached.body);
            setDirty(false);
            setMainView("notes");
            notify("Loaded note from offline cache");
          }
        } catch {
          // ignore
        }
      }
    },
    [activeWorkspaceSlug, notify],
  );

  // Load workspace + AI data whenever authenticated or active workspace changes
  useEffect(() => {
    if (!user) return;
    loadWorkspaceData(activeWorkspaceSlug);
    loadAiData(activeWorkspaceSlug);
  }, [user, activeWorkspaceSlug, loadWorkspaceData, loadAiData]);

  // Auto-open Welcome / first note when workspace loads and no active note is selected in this vault
  useEffect(() => {
    if (!user || notes.length === 0) return;
    const activeInWs =
      activeNote && notes.some((n) => n.id === activeNote.id);
    if (!activeInWs) {
      const firstActive = notes.find((n) => !n.isTrashed);
      if (firstActive) {
        openNote(firstActive.id, { workspaceSlug: activeWorkspaceSlug });
      }
    }
  }, [user, notes, activeNote, activeWorkspaceSlug, openNote]);

  // Real-time SSE listener across browser tabs / devices
  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/events");
    es.addEventListener("workspace", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          type: string;
          workspaceSlug: string;
          noteId?: string;
        };
        if (payload.workspaceSlug === activeWorkspaceSlug) {
          loadWorkspaceData(activeWorkspaceSlug);
          if (
            payload.type.startsWith("ai:") ||
            payload.type === "note:created"
          ) {
            loadAiData(activeWorkspaceSlug, activeConversationId);
          }
          if (
            payload.noteId &&
            activeNoteRef.current?.id === payload.noteId &&
            !dirtyRef.current
          ) {
            openNote(payload.noteId, { workspaceSlug: activeWorkspaceSlug });
          }
        }
      } catch {
        // ignore parse errors
      }
    });
    return () => es.close();
  }, [
    user,
    activeWorkspaceSlug,
    activeConversationId,
    loadWorkspaceData,
    loadAiData,
    openNote,
  ]);

  const queueOfflineEdit = useCallback((edit: OfflineQueuedEdit) => {
    setOfflineQueue((prev) => {
      const filtered = prev.filter((item) => item.noteId !== edit.noteId);
      const next = [...filtered, edit];
      try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const flushOfflineQueue = useCallback(async () => {
    if (offlineQueue.length === 0 || !user || !csrfToken) return;
    const remaining: OfflineQueuedEdit[] = [];

    for (const item of offlineQueue) {
      try {
        const res = await fetch("/api/notes", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            noteId: item.noteId,
            content: item.content,
            baseSha256: item.baseSha256,
            summary: "Offline edit sync",
          }),
        });
        if (res.status === 409) {
          const data = await res.json();
          setConflict({
            noteId: item.noteId,
            title: item.title,
            relPath: item.relPath,
            localContent: item.content,
            serverContent: data.serverContent,
            serverSha256: data.serverSha256,
            serverUpdatedAt: data.serverUpdatedAt,
          });
          notify(`Conflict detected syncing ${item.title}`);
          continue;
        }
        if (!res.ok) {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }

    setOfflineQueue(remaining);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    } catch {
      // ignore
    }
    if (remaining.length === 0) {
      notify("All offline edits reconciled with server");
      loadWorkspaceData(activeWorkspaceSlug);
      if (activeNoteRef.current) {
        openNote(activeNoteRef.current.id);
      }
    }
  }, [offlineQueue, user, csrfToken, notify, loadWorkspaceData, activeWorkspaceSlug, openNote]);

  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      flushOfflineQueue();
    }
  }, [isOnline, offlineQueue.length, flushOfflineQueue]);

  const saveCurrentNote = useCallback(
    async (forceOverwrite = false, overrideContent?: string) => {
      const target = activeNoteRef.current;
      if (!target || !csrfToken) return;
      const contentToSave =
        overrideContent !== undefined ? overrideContent : draftContent;

      if (!navigator.onLine) {
        queueOfflineEdit({
          noteId: target.id,
          workspaceSlug: activeWorkspaceSlug,
          relPath: target.relPath,
          title: target.title,
          content: contentToSave,
          baseSha256: target.sha256,
          queuedAt: Date.now(),
        });
        setDirty(false);
        notify("Offline — edit queued for reconciliation");
        return;
      }

      setSaving(true);
      try {
        const res = await fetch("/api/notes", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            noteId: target.id,
            content: contentToSave,
            baseSha256: target.sha256,
            forceOverwrite,
          }),
        });

        if (res.status === 409) {
          const data = await res.json();
          setConflict({
            noteId: target.id,
            title: target.title,
            relPath: target.relPath,
            localContent: contentToSave,
            serverContent: data.serverContent,
            serverSha256: data.serverSha256,
            serverUpdatedAt: data.serverUpdatedAt,
          });
          return;
        }

        if (res.ok) {
          const data = await res.json();
          setActiveNote(data.note);
          setDirty(false);
          setLastSavedAt(Date.now());
          loadWorkspaceData(activeWorkspaceSlug);
          // Refresh backlinks/outline after save
          openNote(target.id, { workspaceSlug: activeWorkspaceSlug });
        }
      } catch {
        queueOfflineEdit({
          noteId: target.id,
          workspaceSlug: activeWorkspaceSlug,
          relPath: target.relPath,
          title: target.title,
          content: contentToSave,
          baseSha256: target.sha256,
          queuedAt: Date.now(),
        });
        notify("Network interrupted — edit queued offline");
      } finally {
        setSaving(false);
      }
    },
    [
      csrfToken,
      draftContent,
      activeWorkspaceSlug,
      queueOfflineEdit,
      notify,
      loadWorkspaceData,
      openNote,
    ],
  );

  // Debounced autosave (1.3s after user stops typing)
  useEffect(() => {
    if (!dirty || !activeNote) return;
    const timer = setTimeout(() => {
      saveCurrentNote(false);
    }, 1300);
    return () => clearTimeout(timer);
  }, [dirty, draftContent, activeNote, saveCurrentNote]);

  async function handleOpenDaily(dateOverride?: string) {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        action: "daily",
        workspaceSlug: activeWorkspaceSlug,
        ...(dateOverride ? { date: dateOverride } : {}),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await loadWorkspaceData(activeWorkspaceSlug);
      openNote(data.note.id, { workspaceSlug: activeWorkspaceSlug });
    }
  }

  async function handleOpenOrCreateWikiLink(targetName: string) {
    const norm = targetName.trim().toLowerCase();
    const match = notes.find(
      (n) =>
        !n.isTrashed &&
        (n.title.toLowerCase() === norm ||
          n.relPath.replace(/\.md$/i, "").toLowerCase() === norm ||
          n.relPath.split("/").pop()?.replace(/\.md$/i, "").toLowerCase() === norm),
    );
    if (match) {
      openNote(match.id);
      return;
    }

    const res = await fetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        workspaceSlug: activeWorkspaceSlug,
        title: targetName,
        templateId: "blank",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await loadWorkspaceData(activeWorkspaceSlug);
      openNote(data.note.id);
      notify(`Created linked note [[${targetName}]]`);
    }
  }

  async function handleResolveConflict(
    choice: "server" | "local" | "merge",
    mergedContent?: string,
  ) {
    if (!conflict) return;
    if (choice === "server") {
      setDraftContent(conflict.serverContent);
      setDirty(false);
      if (activeNote) {
        setActiveNote({
          ...activeNote,
          body: conflict.serverContent,
          sha256: conflict.serverSha256,
        });
      }
      setConflict(null);
      notify("Kept server copy");
      return;
    }

    const finalContent =
      choice === "local"
        ? conflict.localContent
        : typeof mergedContent === "string"
          ? mergedContent
          : `${conflict.serverContent.trimEnd()}\n\n---\n## Merged Local Draft (${new Date().toLocaleTimeString()})\n${conflict.localContent}`;

    setDraftContent(finalContent);
    setConflict(null);
    await saveCurrentNote(true, finalContent);
    notify(choice === "local" ? "Overwrote server copy" : "Merged both versions");
  }

  const activeWorkspace =
    workspaces.find((w) => w.slug === activeWorkspaceSlug) || workspaces[0] || null;

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (sidebarFilter === "trash") return n.isTrashed;
      if (n.isTrashed) return false;
      if (sidebarFilter === "favorites" && !n.isFavorite) return false;
      if (sidebarFilter === "pinned" && !n.isPinned) return false;
      if (sidebarFilter === "orphans" && !orphanIds.includes(n.id)) return false;
      if (selectedTag && !n.tags.includes(selectedTag)) return false;
      return true;
    });
  }, [notes, sidebarFilter, orphanIds, selectedTag]);

  const notesByFolder = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const n of filteredNotes) {
      const key = n.folder || "(Root)";
      const arr = map.get(key) || [];
      arr.push(n);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "(Root)") return -1;
      if (b === "(Root)") return 1;
      return a.localeCompare(b);
    });
  }, [filteredNotes]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-xs text-zinc-500">
        Initializing CortexMD vaults...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={({ user: u, csrfToken: csrf }) => {
          setUser(u);
          setCsrfToken(csrf);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 px-3 border-b border-zinc-800/90 bg-[#0d0d11] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setLeftOpen((v) => !v)}
            title="Toggle Vault Sidebar"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 cursor-pointer"
          >
            {leftOpen ? (
              <PanelLeftClose className="w-4 h-4 hidden md:block" />
            ) : (
              <PanelLeftOpen className="w-4 h-4 hidden md:block" />
            )}
            <Menu className="w-4 h-4 md:hidden" />
          </button>

          <div className="flex items-center gap-1.5 font-semibold text-sm tracking-tight text-zinc-100">
            <Network className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">CortexMD</span>
          </div>

          <select
            aria-label="Active Workspace"
            value={activeWorkspaceSlug}
            onChange={(e) => setActiveWorkspaceSlug(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-200 focus:outline-none focus:border-emerald-500 max-w-[170px] sm:max-w-[230px]"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.slug}>
                {w.name} ({w.note_count})
              </option>
            ))}
          </select>
        </div>

        {/* Center Command Palette & View Modes */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-700 px-3 py-1 text-xs text-zinc-400 min-w-[200px] lg:min-w-[280px] justify-between cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              Search notes &amp; concepts...
            </span>
            <kbd className="text-[10px] font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500">
              Ctrl K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            title="Search"
            className="sm:hidden p-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>

          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setMainView("home")}
              className={`framer-press inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "home"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Home</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("notes")}
              className={`framer-press inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "notes"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Notes</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("graph")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "graph"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Graph</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("kanban")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "kanban"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Tasks</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("canvas")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "canvas"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Canvas</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("calendar")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "calendar"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Calendar</span>
            </button>
            <button
              type="button"
              onClick={() => setMainView("cards")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${
                mainView === "cards"
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Cards</span>
            </button>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMainView("home")}
            title={`Daily knowledge streak: ${streakDays} day${streakDays === 1 ? "" : "s"}`}
            className="framer-press hidden sm:inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/15 transition cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{streakDays}d</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title={
              theme === "obsidian"
                ? "Switch to Paper / Aesop light theme"
                : "Switch to Obsidian dark theme"
            }
            aria-label="Toggle color theme"
            className="framer-press inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 transition cursor-pointer"
          >
            {theme === "obsidian" ? (
              <Sun className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span className="hidden xl:inline capitalize">{theme}</span>
          </button>

          <button
            type="button"
            onClick={() => setZenMode((v) => !v)}
            title={zenMode ? "Exit Zen Focus Mode" : "Enter Zen Focus Mode"}
            aria-pressed={zenMode}
            className={`framer-press inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition cursor-pointer ${
              zenMode
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 font-medium"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {zenMode ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden xl:inline">{zenMode ? "Exit Zen" : "Zen"}</span>
          </button>
          {!isOnline || offlineQueue.length > 0 ? (
            <button
              type="button"
              onClick={flushOfflineQueue}
              title="Click to reconcile offline edits"
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">
                {offlineQueue.length > 0
                  ? `${offlineQueue.length} Queued`
                  : "Offline"}
              </span>
            </button>
          ) : (
            <span
              title="Real-time server sync connected"
              className="hidden md:inline-flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300"
            >
              <Cloud className="w-3 h-3" />
              Live
            </span>
          )}

          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            title="AI Providers & Vault Settings"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            title="Toggle AI Studio Sidebar"
            className={`p-1.5 rounded-lg cursor-pointer ${
              rightOpen
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
            }`}
          >
            {rightOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              setUser(null);
            }}
            title="Sign out"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Three-Pane Workspace */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Navigation Rail */}
        {leftOpen && !zenMode && (
          <nav className="w-64 lg:w-72 shrink-0 border-r border-zinc-800/90 bg-[#0d0d11] flex flex-col min-h-0 z-20 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-2xl">
            <div className="p-2.5 border-b border-zinc-800/80 grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setNewNoteModalOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold py-1.5 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" /> New Note
              </button>
              <button
                type="button"
                onClick={() => handleOpenDaily()}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 py-1.5 cursor-pointer"
              >
                <CalendarDays className="w-3.5 h-3.5 text-amber-400" /> Daily
              </button>
            </div>

            {/* Filter Pills */}
            <div className="px-2.5 py-2 border-b border-zinc-800/60 flex flex-wrap gap-1 text-[11px]">
              {(
                [
                  { id: "all", label: "All", icon: FileText },
                  { id: "pinned", label: "Pinned", icon: Pin },
                  { id: "favorites", label: "Starred", icon: Star },
                  { id: "orphans", label: `Orphans (${orphanIds.length})`, icon: AlertCircle },
                  { id: "trash", label: "Trash", icon: Trash2 },
                ] as const
              ).map((f) => {
                const Icon = f.icon;
                const active = sidebarFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSidebarFilter(f.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer ${
                      active
                        ? "bg-zinc-800 text-zinc-100 font-medium"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {f.label}
                  </button>
                );
              })}
            </div>

            {selectedTag && (
              <div className="mx-2.5 mt-2 flex items-center justify-between rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-[11px] text-emerald-300">
                <span>Tag: #{selectedTag}</span>
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Folder & Note Explorer */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
              {notesByFolder.length === 0 ? (
                <div className="p-4 text-center text-zinc-500 text-[11px]">
                  No notes match the current filter.
                </div>
              ) : (
                notesByFolder.map(([folderName, folderNotes]) => {
                  const collapsed = collapsedFolders.has(folderName);
                  return (
                    <div key={folderName} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(folderName)) next.delete(folderName);
                            else next.add(folderName);
                            return next;
                          })
                        }
                        className="w-full flex items-center justify-between px-1.5 py-1 rounded text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 truncate">
                          {collapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                          <Folder className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="truncate">{folderName}</span>
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {folderNotes.length}
                        </span>
                      </button>

                      {!collapsed &&
                        folderNotes.map((n) => {
                          const isSelected = activeNote?.id === n.id;
                          return (
                            <div
                              key={n.id}
                              onClick={() => {
                                openNote(n.id);
                                if (typeof window !== "undefined" && window.innerWidth < 768) {
                                  setLeftOpen(false);
                                }
                              }}
                              className={`group flex items-center justify-between gap-1.5 pl-6 pr-2 py-1.5 rounded-lg cursor-pointer ${
                                isSelected
                                  ? "bg-emerald-500/12 text-emerald-200 border border-emerald-500/25"
                                  : "text-zinc-300 hover:bg-zinc-900/80"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                                <span className="truncate">{n.title}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {n.isPinned && (
                                  <Pin className="w-2.5 h-2.5 text-emerald-400" />
                                )}
                                {n.isFavorite && (
                                  <Star className="w-2.5 h-2.5 text-amber-400" />
                                )}
                                {n.isTrashed && (
                                  <button
                                    type="button"
                                    title="Restore note from Trash"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      await fetch("/api/notes", {
                                        method: "PUT",
                                        headers: {
                                          "Content-Type": "application/json",
                                          "x-csrf-token": csrfToken,
                                        },
                                        body: JSON.stringify({
                                          action: "restore",
                                          noteId: n.id,
                                        }),
                                      });
                                      loadWorkspaceData(activeWorkspaceSlug);
                                    }}
                                    className="text-emerald-400 hover:text-emerald-200 p-0.5 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  );
                })
              )}

              {/* Tags Section */}
              {tags.length > 0 && (
                <div className="pt-3 border-t border-zinc-800/80 space-y-1.5">
                  <div className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1 px-1">
                    {tags.slice(0, 18).map((t) => (
                      <button
                        key={t.tag}
                        type="button"
                        onClick={() =>
                          setSelectedTag((prev) => (prev === t.tag ? null : t.tag))
                        }
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${
                          selectedTag === t.tag
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                        }`}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {t.tag}
                        <span className="text-zinc-600">{t.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Saved Smart Searches */}
              {savedSearches.length > 0 && (
                <div className="pt-3 border-t border-zinc-800/80 space-y-1.5">
                  <div className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Saved Searches
                  </div>
                  <div className="space-y-1 px-1">
                    {savedSearches.map((s) => (
                      <div
                        key={s.id}
                        className="group flex items-center justify-between gap-1 rounded-md border border-zinc-800/80 bg-zinc-950/70 hover:border-emerald-500/35 px-2 py-1 text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setCmdInitialQuery(s.query);
                            setCmdOpen(true);
                          }}
                          className="flex items-center gap-1.5 min-w-0 text-left text-zinc-300 hover:text-emerald-300 cursor-pointer flex-1"
                        >
                          <Bookmark className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="truncate">{s.name}</span>
                        </button>
                        <button
                          type="button"
                          title="Delete saved search"
                          onClick={async () => {
                            const res = await fetch(
                              `/api/search/saved?id=${encodeURIComponent(s.id)}`,
                              {
                                method: "DELETE",
                                headers: { "x-csrf-token": csrfToken },
                              },
                            );
                            if (res.ok) {
                              setSavedSearches((prev) =>
                                prev.filter((item) => item.id !== s.id),
                              );
                            }
                          }}
                          className="text-zinc-600 hover:text-rose-400 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Vault Actions */}
            <div className="p-2.5 border-t border-zinc-800/80 flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 py-1.5 cursor-pointer"
              >
                <Upload className="w-3 h-3 text-purple-400" />
                Import Vault
              </button>
              <button
                type="button"
                onClick={() => setNewWorkspaceModalOpen(true)}
                className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 py-1.5 cursor-pointer"
              >
                <FolderPlus className="w-3 h-3 text-blue-400" />
                New Vault
              </button>
            </div>
          </nav>
        )}

        {/* Center Canvas */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {mainView === "home" && (
            <VaultHomeDashboard
              workspaceName={activeWorkspace?.name || activeWorkspaceSlug}
              workspaceSlug={activeWorkspaceSlug}
              notes={notes}
              tasks={tasks}
              graph={graph}
              conversationsCount={conversations.length}
              streakDays={streakDays}
              csrfToken={csrfToken}
              onOpenNote={(id) => openNote(id)}
              onCreateNote={() => setNewNoteModalOpen(true)}
              onOpenDaily={() => handleOpenDaily()}
              onOpenView={(v) => setMainView(v)}
              onOpenAi={() => {
                setZenMode(false);
                setRightOpen(true);
              }}
              onCaptured={() => loadWorkspaceData(activeWorkspaceSlug)}
              onNotify={notify}
            />
          )}

          {mainView === "notes" && (
            <MarkdownWorkspace
              workspaceSlug={activeWorkspaceSlug}
              workspaceNotes={notes}
              openTabs={openTabs}
              activeNote={activeNote}
              draftContent={draftContent}
              dirty={dirty}
              saving={saving}
              lastSavedAt={lastSavedAt}
              headings={headings}
              outgoingLinks={outgoingLinks}
              backlinks={backlinks}
              unlinkedMentions={unlinkedMentions}
              relatedNotes={relatedNotes}
              versions={versions}
              localGraph={localGraph}
              transclusions={transclusions}
              queryResults={queryResults}
              highlightLines={highlightLines}
              conflict={conflict}
              onClearHighlight={() => setHighlightLines(null)}
              onSelectTab={(id) => openNote(id)}
              onCloseTab={(id) => {
                setOpenTabs((prev) => {
                  const next = prev.filter((t) => t.id !== id);
                  if (activeNote?.id === id) {
                    const fallback = next[next.length - 1];
                    if (fallback) openNote(fallback.id);
                    else setActiveNote(null);
                  }
                  return next;
                });
              }}
              onChangeDraft={(next) => {
                setDraftContent(next);
                setDirty(true);
              }}
              onSaveNow={(force) => saveCurrentNote(force)}
              onRenameNote={async (newRelPath) => {
                if (!activeNote) return;
                const res = await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "rename",
                    noteId: activeNote.id,
                    newRelPath,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data.error || "Failed to rename note");
                }
                const renamed = data.note as NoteDetail;
                setOpenTabs((prev) =>
                  prev.map((t) =>
                    t.id === renamed.id
                      ? { id: renamed.id, title: renamed.title, relPath: renamed.relPath }
                      : t,
                  ),
                );
                await openNote(renamed.id);
                loadWorkspaceData(activeWorkspaceSlug);
                notify(
                  `Renamed to ${renamed.relPath} (refactored ${data.refactoredBacklinksCount ?? 0} backlink(s) across ${data.updatedReferrerCount ?? 0} note(s)).`,
                );
              }}
              onInlineRewrite={async ({ selectedText, instruction, noteRelPath }) => {
                const enabledExternal = providers.find(
                  (p) => p.available && p.configured && p.id !== "local-hybrid",
                );
                const res = await fetch("/api/ai/rewrite", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    workspaceSlug: activeWorkspaceSlug,
                    noteRelPath,
                    selectedText,
                    instruction,
                    providerId: (enabledExternal?.id || "local-hybrid") as ProviderId,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data.error || "Inline AI rewrite failed");
                }
                return {
                  replacementText: data.replacementText,
                  diffPreview: data.diffPreview,
                  fallbackWarning: data.fallbackWarning,
                };
              }}
              onToggleFavorite={async () => {
                if (!activeNote) return;
                await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "toggleFavorite",
                    noteId: activeNote.id,
                  }),
                });
                openNote(activeNote.id);
                loadWorkspaceData(activeWorkspaceSlug);
              }}
              onTogglePin={async () => {
                if (!activeNote) return;
                await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "togglePin",
                    noteId: activeNote.id,
                  }),
                });
                openNote(activeNote.id);
                loadWorkspaceData(activeWorkspaceSlug);
              }}
              onTrashNote={async () => {
                if (!activeNote) return;
                await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "trash",
                    noteId: activeNote.id,
                  }),
                });
                setActiveNote(null);
                loadWorkspaceData(activeWorkspaceSlug);
                notify("Moved note to Trash");
              }}
              onUploadAttachment={async (file) => {
                const formData = new FormData();
                formData.append("workspaceSlug", activeWorkspaceSlug);
                formData.append("file", file);
                const res = await fetch("/api/attachments", {
                  method: "POST",
                  headers: { "x-csrf-token": csrfToken },
                  body: formData,
                });
                if (!res.ok) {
                  notify("Attachment upload failed");
                  return null;
                }
                const data = await res.json();
                notify(`Uploaded ${file.name}`);
                return data.markdownEmbed as string;
              }}
              onOpenNoteById={(id, line) => openNote(id, { line })}
              onOpenOrCreateWikiLink={handleOpenOrCreateWikiLink}
              onLinkMention={async (mention) => {
                if (!activeNote) return;
                const res = await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "linkMention",
                    sourceNoteId: mention.sourceNoteId,
                    lineNumber: mention.lineNumber,
                    matchedTerm: mention.matchedTerm,
                    targetTitle: activeNote.title,
                  }),
                });
                if (res.ok) {
                  openNote(activeNote.id);
                  loadWorkspaceData(activeWorkspaceSlug);
                  notify(`Converted mention in ${mention.sourceTitle} into WikiLink`);
                }
              }}
              onRestoreVersion={async (versionId) => {
                if (!activeNote) return;
                const res = await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "restoreVersion",
                    noteId: activeNote.id,
                    versionId,
                  }),
                });
                if (res.ok) {
                  openNote(activeNote.id);
                  notify("Restored note snapshot");
                }
              }}
              onResolveConflict={handleResolveConflict}
              onToggleCheckboxLine={async (lineNumber) => {
                if (!activeNote) return;
                const res = await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "toggleTask",
                    noteId: activeNote.id,
                    lineNumber,
                  }),
                });
                if (res.ok) {
                  openNote(activeNote.id);
                  loadWorkspaceData(activeWorkspaceSlug);
                }
              }}
              onAskAiAboutNote={() => setRightOpen(true)}
            />
          )}

          {mainView === "graph" && (
            <KnowledgeGraph
              graph={graph}
              activeNoteId={activeNote?.id}
              onSelectNote={(id) => openNote(id)}
            />
          )}

          {mainView === "kanban" && (
            <KanbanTasksView
              tasks={tasks}
              onToggleTask={async (noteId, lineNumber) => {
                await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "toggleTask",
                    noteId,
                    lineNumber,
                  }),
                });
                loadWorkspaceData(activeWorkspaceSlug);
                if (activeNote?.id === noteId) openNote(noteId);
              }}
              onUpdateTask={async (noteId, lineNumber, patch) => {
                await fetch("/api/notes", {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    action: "updateTask",
                    noteId,
                    lineNumber,
                    status: patch.status,
                    priority: patch.priority,
                  }),
                });
                loadWorkspaceData(activeWorkspaceSlug);
                if (activeNote?.id === noteId) openNote(noteId);
              }}
              onOpenNote={(id, line) => openNote(id, { line })}
            />
          )}

          {mainView === "canvas" && (
            <SpatialCanvasView
              workspaceSlug={activeWorkspaceSlug}
              csrfToken={csrfToken}
              notes={notes}
              onOpenNoteById={(id) => openNote(id)}
              onNotify={notify}
            />
          )}

          {mainView === "calendar" && (
            <CalendarHeatmapView
              workspaceSlug={activeWorkspaceSlug}
              notes={notes}
              tasks={tasks}
              onOpenNoteById={(id) => openNote(id)}
              onOpenDailyForDate={(isoDate) => handleOpenDaily(isoDate)}
            />
          )}

          {mainView === "cards" && (
            <FlashcardReviewView
              workspaceSlug={activeWorkspaceSlug}
              csrfToken={csrfToken}
              onOpenNote={(id, line) => openNote(id, { line })}
              onNotify={notify}
            />
          )}
        </main>

        {/* Right AI Studio Sidebar */}
        {rightOpen && !zenMode && (
          <div className="w-80 xl:w-96 shrink-0 flex flex-col min-h-0 z-20 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl">
            <AiSidebar
              workspaceSlug={activeWorkspaceSlug}
              folders={folders}
              activeNoteId={activeNote?.id}
              providers={providers}
              conversations={conversations}
              activeConversationId={activeConversationId}
              messages={messages}
              pendingActions={pendingActions}
              aclRules={aclRules}
              auditLogs={auditLogs}
              sending={aiSending}
              onSelectConversation={(id) => loadAiData(activeWorkspaceSlug, id)}
              onDeleteConversation={async (id) => {
                await fetch(
                  `/api/ai/conversations?conversationId=${encodeURIComponent(id)}`,
                  {
                    method: "DELETE",
                    headers: { "x-csrf-token": csrfToken },
                  },
                );
                loadAiData(activeWorkspaceSlug, null);
              }}
              onSendMessage={async ({
                prompt,
                providerId,
                scopeMode,
                folderPrefix,
                runContradictionScan,
              }) => {
                setAiSending(true);
                const tempUserId = `temp-user-${Date.now()}`;
                const tempBotId = `temp-bot-${Date.now()}`;
                const now = Date.now();
                const convKey = activeConversationId || "streaming";
                setMessages((prev) => [
                  ...prev,
                  {
                    id: tempUserId,
                    conversationId: convKey,
                    role: "user",
                    content: prompt,
                    citations: [],
                    toolProposals: [],
                    createdAt: now,
                  },
                  {
                    id: tempBotId,
                    conversationId: convKey,
                    role: "assistant",
                    content: "",
                    citations: [],
                    toolProposals: [],
                    createdAt: now + 1,
                  },
                ]);

                try {
                  const res = await fetch("/api/ai/chat", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-csrf-token": csrfToken,
                    },
                    body: JSON.stringify({
                      prompt,
                      workspaceSlug: activeWorkspaceSlug,
                      conversationId: activeConversationId || undefined,
                      providerId,
                      scopeMode,
                      folderPrefix,
                      noteId: activeNote?.id,
                      runContradictionScan,
                      stream: true,
                    }),
                  });

                  const contentType = res.headers.get("content-type") || "";
                  if (res.ok && contentType.includes("text/event-stream") && res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let finalConversationId = activeConversationId || "";

                    while (true) {
                      const { value, done } = await reader.read();
                      if (done) break;
                      buffer += decoder.decode(value, { stream: true });
                      const blocks = buffer.split("\n\n");
                      buffer = blocks.pop() || "";

                      for (const block of blocks) {
                        const lines = block.split("\n");
                        let evtName = "message";
                        let dataStr = "";
                        for (const line of lines) {
                          if (line.startsWith("event:")) {
                            evtName = line.slice(6).trim();
                          } else if (line.startsWith("data:")) {
                            dataStr += line.slice(5).trim();
                          }
                        }
                        if (!dataStr) continue;
                        try {
                          const parsed = JSON.parse(dataStr);
                          if (evtName === "meta") {
                            finalConversationId = parsed.conversationId || finalConversationId;
                            if (parsed.conversationId) {
                              setActiveConversationId(parsed.conversationId);
                            }
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === tempBotId
                                  ? {
                                      ...m,
                                      conversationId: parsed.conversationId || m.conversationId,
                                      citations: parsed.citations || [],
                                      toolProposals: parsed.proposals || [],
                                    }
                                  : m,
                              ),
                            );
                          } else if (evtName === "delta") {
                            const chunk = String(parsed.chunk || "");
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === tempBotId
                                  ? { ...m, content: `${m.content}${chunk}` }
                                  : m,
                              ),
                            );
                          } else if (evtName === "done") {
                            finalConversationId = parsed.conversationId || finalConversationId;
                          }
                        } catch {
                          // ignore malformed chunk
                        }
                      }
                    }

                    if (finalConversationId) {
                      setActiveConversationId(finalConversationId);
                      await loadAiData(activeWorkspaceSlug, finalConversationId);
                    }
                  } else {
                    const data = await res.json();
                    if (res.ok) {
                      setActiveConversationId(data.conversationId);
                      await loadAiData(activeWorkspaceSlug, data.conversationId);
                    } else {
                      setMessages((prev) =>
                        prev.filter((m) => m.id !== tempUserId && m.id !== tempBotId),
                      );
                      notify(data.error || "AI query failed");
                    }
                  }
                } finally {
                  setAiSending(false);
                }
              }}
              onApproveAction={async (actionId) => {
                const res = await fetch("/api/ai/actions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({ decision: "approve", actionId }),
                });
                const data = await res.json();
                if (res.ok) {
                  notify(`Approved & wrote ${data.appliedPath}`);
                  await loadWorkspaceData(activeWorkspaceSlug);
                  await loadAiData(activeWorkspaceSlug, activeConversationId);
                  if (activeNote) openNote(activeNote.id);
                } else {
                  notify(data.error || "Approval failed");
                }
              }}
              onRejectAction={async (actionId) => {
                const res = await fetch("/api/ai/actions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({ decision: "reject", actionId }),
                });
                if (res.ok) {
                  notify("Rejected agent proposal");
                  loadAiData(activeWorkspaceSlug, activeConversationId);
                }
              }}
              onAddAclRule={async (folderPrefix, permission) => {
                const res = await fetch("/api/ai/permissions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    workspaceSlug: activeWorkspaceSlug,
                    folderPrefix,
                    permission,
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setAclRules(data.rules || []);
                  notify(`Saved ACL: ${permission} ${folderPrefix}/`);
                }
              }}
              onDeleteAclRule={async (ruleId) => {
                const res = await fetch(
                  `/api/ai/permissions?workspaceSlug=${encodeURIComponent(activeWorkspaceSlug)}&ruleId=${encodeURIComponent(ruleId)}`,
                  {
                    method: "DELETE",
                    headers: { "x-csrf-token": csrfToken },
                  },
                );
                if (res.ok) {
                  const data = await res.json();
                  setAclRules(data.rules || []);
                }
              }}
              onJumpToCitation={(citation: RagCitationItem) => {
                openNote(citation.noteId, {
                  workspaceSlug: citation.workspaceSlug,
                  line: citation.startLine,
                  endLine: citation.endLine,
                });
              }}
              onIngestSource={async (input) => {
                const res = await fetch("/api/ai/ingest", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    workspaceSlug: activeWorkspaceSlug,
                    ...input,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  notify(data.error || "Source ingest failed");
                  return null;
                }
                notify(`Clipped source → ${data.note?.relPath}`);
                await loadWorkspaceData(activeWorkspaceSlug);
                await loadAiData(activeWorkspaceSlug, activeConversationId);
                return data;
              }}
              onRunGardener={async (providerId) => {
                const res = await fetch("/api/ai/gardener", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    workspaceSlug: activeWorkspaceSlug,
                    providerId,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  notify(data.error || "Vault Gardener failed");
                  return null;
                }
                notify(
                  `Vault Gardener scanned ${data.stats?.scannedNotes ?? 0} notes (${data.proposals?.length ?? 0} diffs queued)`,
                );
                await loadAiData(activeWorkspaceSlug, activeConversationId);
                return data.stats;
              }}
              onGenerateBriefing={async (input) => {
                const res = await fetch("/api/ai/briefing", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrfToken,
                  },
                  body: JSON.stringify({
                    workspaceSlug: activeWorkspaceSlug,
                    noteId: activeNote?.id,
                    ...input,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  notify(data.error || "Briefing generation failed");
                  return null;
                }
                if (data.savedRelPath) {
                  notify(`Saved briefing → ${data.savedRelPath}`);
                  await loadWorkspaceData(activeWorkspaceSlug);
                  await loadAiData(activeWorkspaceSlug, activeConversationId);
                }
                return data;
              }}
              onOpenNoteById={(noteId) => openNote(noteId)}
            />
          </div>
        )}
      </div>

      {zenMode && (
        <button
          type="button"
          onClick={() => setZenMode(false)}
          className="apple-glass framer-press fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-3.5 py-2 text-xs font-medium text-emerald-300 shadow-2xl hover:border-emerald-400 transition cursor-pointer"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Exit Zen Mode</span>
        </button>
      )}

      {/* Modals */}
      <CommandPalette
        open={cmdOpen}
        workspaceSlug={activeWorkspaceSlug}
        initialQuery={cmdInitialQuery}
        availableTags={tags.map((t) => t.tag)}
        availableFolders={folders}
        onClose={() => setCmdOpen(false)}
        onOpenNote={(id, slug, line) => openNote(id, { workspaceSlug: slug, line })}
        onSaveSearch={async (name, query) => {
          const res = await fetch("/api/search/saved", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify({
              workspaceSlug: activeWorkspaceSlug,
              name,
              query,
            }),
          });
          const data = await res.json();
          if (res.ok && data.search) {
            setSavedSearches((prev) => [data.search, ...prev]);
            notify(`Saved smart search "${data.search.name}"`);
          } else {
            notify(data.error || "Failed to save search");
          }
        }}
        onAction={(act) => {
          if (act === "new-note") setNewNoteModalOpen(true);
          else if (act === "daily-note") handleOpenDaily();
          else if (act === "graph") setMainView("graph");
          else if (act === "kanban") setMainView("kanban");
          else if (act === "import") setImportModalOpen(true);
          else if (act === "ai-chat") setRightOpen(true);
        }}
      />

      <NewNoteModal
        open={newNoteModalOpen}
        templates={templates}
        folders={folders}
        onClose={() => setNewNoteModalOpen(false)}
        onCreate={async ({ title, folder, templateId }) => {
          const res = await fetch("/api/notes", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify({
              workspaceSlug: activeWorkspaceSlug,
              title,
              folder,
              templateId,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            await loadWorkspaceData(activeWorkspaceSlug);
            openNote(data.note.id);
          }
        }}
      />

      <NewWorkspaceModal
        open={newWorkspaceModalOpen}
        onClose={() => setNewWorkspaceModalOpen(false)}
        onCreate={async (name, description) => {
          const res = await fetch("/api/workspaces", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify({ name, description }),
          });
          if (res.ok) {
            const data = await res.json();
            setActiveNote(null);
            setActiveWorkspaceSlug(data.workspace.slug);
          }
        }}
      />

      <ImportVaultModal
        open={importModalOpen}
        csrfToken={csrfToken}
        onClose={() => setImportModalOpen(false)}
        onImported={async (slug) => {
          setActiveNote(null);
          setActiveWorkspaceSlug(slug);
          await loadWorkspaceData(slug);
          notify(`Imported vault into ${slug}`);
        }}
      />

      <SettingsModal
        open={settingsModalOpen}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        providers={providers}
        csrfToken={csrfToken}
        currentUser={user}
        onNotify={notify}
        onClose={() => setSettingsModalOpen(false)}
        onSaveProvider={async (input) => {
          const res = await fetch("/api/ai/providers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify(input),
          });
          if (res.ok) {
            const data = await res.json();
            setProviders(data.providers || []);
          }
        }}
      />

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-full border border-emerald-500/40 bg-zinc-950/95 px-4 py-2 text-xs text-emerald-300 shadow-2xl flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
