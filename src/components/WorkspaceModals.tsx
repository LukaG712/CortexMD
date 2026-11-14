"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Download,
  FilePlus2,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  KeyRound,
  Settings,
  Shield,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  NoteTemplateItem,
  ProviderId,
  ProviderStatusItem,
  TaskItem,
  WorkspaceItem,
} from "@/lib/types";

interface KanbanTasksViewProps {
  tasks: TaskItem[];
  onToggleTask: (noteId: string, lineNumber: number) => Promise<void>;
  onUpdateTask?: (
    noteId: string,
    lineNumber: number,
    patch: { status?: "todo" | "doing" | "done"; priority?: "A" | "B" | "C" | null },
  ) => Promise<void>;
  onOpenNote: (noteId: string, lineNumber: number) => void;
}

export function KanbanTasksView({
  tasks,
  onToggleTask,
  onUpdateTask,
  onOpenNote,
}: KanbanTasksViewProps) {
  const [dragOverCol, setDragOverCol] = useState<"todo" | "doing" | "done" | null>(null);
  const columns: Array<{ id: "todo" | "doing" | "done"; title: string; accent: string }> = [
    { id: "todo", title: "Backlog / To Do", accent: "border-zinc-700 text-zinc-200" },
    { id: "doing", title: "In Progress / Doing", accent: "border-blue-500/40 text-blue-300" },
    { id: "done", title: "Done", accent: "border-emerald-500/40 text-emerald-300" },
  ];

  const nextPriority = (cur: TaskItem["priority"]): "A" | "B" | "C" | null => {
    if (!cur) return "A";
    if (cur === "A") return "B";
    if (cur === "B") return "C";
    return null;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0a0a0d]">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Workspace Tasks &amp; Kanban
            </h2>
            <p className="text-xs text-zinc-400">
              Drag cards between columns or click priority tags — writes directly back into Markdown files.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            {tasks.filter((t) => !t.completed).length} open / {tasks.length} total
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {columns.map((col) => {
            const items = tasks.filter((t) => t.status === col.id);
            const isOver = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== col.id) setDragOverCol(col.id);
                }}
                onDragLeave={() => {
                  if (dragOverCol === col.id) setDragOverCol(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  if (!onUpdateTask) return;
                  try {
                    const raw = e.dataTransfer.getData("application/json");
                    if (!raw) return;
                    const payload = JSON.parse(raw) as {
                      noteId: string;
                      lineNumber: number;
                      status: string;
                    };
                    if (payload.status !== col.id) {
                      await onUpdateTask(payload.noteId, payload.lineNumber, {
                        status: col.id,
                      });
                    }
                  } catch {
                    // ignore invalid drag payload
                  }
                }}
                className={`rounded-xl border bg-[#101014] flex flex-col min-h-[260px] transition ${
                  isOver
                    ? "border-emerald-500 ring-1 ring-emerald-500/40 bg-emerald-950/10"
                    : "border-zinc-800/90"
                }`}
              >
                <div
                  className={`px-3.5 py-2.5 border-b border-zinc-800/80 flex items-center justify-between text-xs font-semibold ${col.accent}`}
                >
                  <span>{col.title}</span>
                  <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-400">
                    {items.length}
                  </span>
                </div>

                <div className="p-2.5 space-y-2 overflow-y-auto max-h-[65vh] flex-1">
                  {items.length === 0 ? (
                    <div className="text-xs text-zinc-600 p-4 text-center">
                      Drop tasks here or add checkboxes in any note
                    </div>
                  ) : (
                    items.map((t, idx) => (
                      <div
                        key={`${t.noteId}-${t.lineNumber}-${idx}`}
                        draggable={Boolean(onUpdateTask)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/json",
                            JSON.stringify({
                              noteId: t.noteId,
                              lineNumber: t.lineNumber,
                              status: t.status,
                            }),
                          );
                        }}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2 hover:border-zinc-700 cursor-grab active:cursor-grabbing"
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleTask(t.noteId, t.lineNumber)}
                            className="mt-0.5 text-zinc-400 hover:text-emerald-400 cursor-pointer shrink-0"
                            title="Toggle completion in .md file"
                          >
                            {t.completed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1 text-xs text-zinc-200 leading-relaxed">
                            <span className={t.completed ? "line-through text-zinc-500" : ""}>
                              {t.text}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px] pl-6">
                          <button
                            type="button"
                            onClick={() => onOpenNote(t.noteId, t.lineNumber)}
                            className="font-mono text-zinc-400 hover:text-emerald-300 truncate cursor-pointer"
                          >
                            {t.relPath}#L{t.lineNumber}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            {onUpdateTask && (
                              <select
                                value={t.status}
                                onChange={(e) =>
                                  onUpdateTask(t.noteId, t.lineNumber, {
                                    status: e.target.value as "todo" | "doing" | "done",
                                  })
                                }
                                title="Move column"
                                className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-300 focus:outline-none"
                              >
                                <option value="todo">To Do</option>
                                <option value="doing">Doing</option>
                                <option value="done">Done</option>
                              </select>
                            )}
                            <button
                              type="button"
                              title="Cycle priority (#A / #B / #C / None)"
                              onClick={() =>
                                onUpdateTask?.(t.noteId, t.lineNumber, {
                                  priority: nextPriority(t.priority),
                                })
                              }
                              className={`px-1.5 py-0.5 rounded font-semibold cursor-pointer ${
                                t.priority === "A"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : t.priority === "B"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : t.priority === "C"
                                      ? "bg-blue-500/20 text-blue-300"
                                      : "bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300"
                              }`}
                            >
                              {t.priority ? `#${t.priority}` : "+P"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface NewNoteModalProps {
  open: boolean;
  templates: NoteTemplateItem[];
  folders: string[];
  onClose: () => void;
  onCreate: (input: {
    title: string;
    folder: string;
    templateId: string;
  }) => Promise<void>;
}

export function NewNoteModal({
  open,
  templates,
  folders,
  onClose,
  onCreate,
}: NewNoteModalProps) {
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm text-zinc-100">
            <FilePlus2 className="w-4 h-4 text-emerald-400" />
            <span>Create Markdown Note</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || submitting) return;
            setSubmitting(true);
            try {
              await onCreate({
                title: title.trim(),
                folder: folder.trim(),
                templateId,
              });
              setTitle("");
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
          className="space-y-3 text-xs"
        >
          <div className="space-y-1">
            <label className="text-zinc-300 font-medium">Note Title</label>
            <input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Caddy Reverse Proxy Architecture"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-300 font-medium">
              Folder Path (optional)
            </label>
            <input
              list="existing-folders"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Leave blank for vault root or type e.g. Projects/Homelab"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
            />
            <datalist id="existing-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium">Template</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setTemplateId(tpl.id);
                    if (!folder && tpl.folder) setFolder(tpl.folder);
                  }}
                  className={`text-left rounded-lg border p-2.5 cursor-pointer ${
                    templateId === tpl.id
                      ? "border-emerald-500 bg-emerald-500/10 text-zinc-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <div className="font-semibold text-xs">{tpl.name}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">
                    {tpl.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold cursor-pointer"
            >
              {submitting ? "Creating..." : "Create .md File"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NewWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

export function NewWorkspaceModal({
  open,
  onClose,
  onCreate,
}: NewWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm text-zinc-100">
            <FolderPlus className="w-4 h-4 text-blue-400" />
            <span>Create Knowledge Vault</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || loading) return;
            setLoading(true);
            try {
              await onCreate(name.trim(), description.trim());
              setName("");
              setDescription("");
              onClose();
            } finally {
              setLoading(false);
            }
          }}
          className="space-y-3 text-xs"
        >
          <div className="space-y-1">
            <label className="text-zinc-300 font-medium">Vault Name</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Software Engineering"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div className="space-y-1">
            <label className="text-zinc-300 font-medium">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Architecture notes, RFCs, code snippets"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
            >
              {loading ? "Creating..." : "Create Vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ImportVaultModalProps {
  open: boolean;
  csrfToken: string;
  onClose: () => void;
  onImported: (workspaceSlug: string) => Promise<void>;
}

export function ImportVaultModal({
  open,
  csrfToken,
  onClose,
  onImported,
}: ImportVaultModalProps) {
  const [workspaceName, setWorkspaceName] = useState("Imported Obsidian Vault");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const dirInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setStatus("Importing folders, notes, metadata, and attachments...");
    try {
      const formData = new FormData();
      formData.append("workspaceName", workspaceName.trim() || "Imported Vault");
      const relPaths: string[] = [];
      for (const f of files) {
        const webkitRel = (f as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        relPaths.push(webkitRel || f.name);
        formData.append("files", f);
      }
      formData.append("paths", JSON.stringify(relPaths));

      const res = await fetch("/api/workspaces/import", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Import failed");
        return;
      }
      setStatus(
        `Imported ${data.importedMdCount} Markdown note(s) and ${data.importedAssetCount} attachment(s).`,
      );
      setFiles([]);
      await onImported(data.workspace.slug);
      onClose();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm text-zinc-100">
            <Upload className="w-4 h-4 text-purple-400" />
            <span>Import Obsidian Vault</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleUpload} className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="text-zinc-300 font-medium">
              Destination Workspace Name
            </label>
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
            />
          </div>

          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/70 p-4 text-center space-y-2">
            <p className="text-zinc-300">
              Select your Obsidian vault directory (preserves nested folders, YAML frontmatter, tags, <code>[[WikiLinks]]</code>, and attachments).
            </p>
            <input
              ref={dirInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is standard in Chromium/Edge/Firefox for directory upload
              webkitdirectory=""
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <button
              type="button"
              onClick={() => dirInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-purple-400" />
              Choose Vault Folder
            </button>
            {files.length > 0 && (
              <div className="text-emerald-400 font-medium">
                {files.length} files staged for import
              </div>
            )}
          </div>

          {status && <div className="text-zinc-300">{status}</div>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || files.length === 0}
              className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
            >
              {uploading ? "Importing..." : "Import Vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SettingsModalProps {
  open: boolean;
  activeWorkspace: WorkspaceItem | null;
  workspaces: WorkspaceItem[];
  providers: ProviderStatusItem[];
  csrfToken: string;
  currentUser: { id: string; username: string; role: string } | null;
  onClose: () => void;
  onSaveProvider: (input: {
    providerId: ProviderId;
    enabled: boolean;
    secret?: string;
    endpointUrl?: string;
    modelName?: string;
  }) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function SettingsModal({
  open,
  activeWorkspace,
  workspaces,
  providers,
  csrfToken,
  currentUser,
  onClose,
  onSaveProvider,
  onNotify,
}: SettingsModalProps) {
  const [editingId, setEditingId] = useState<ProviderId | null>(null);
  const [secret, setSecret] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [savedNotice, setSavedNotice] = useState("");

  // Item 21: Git snapshot state
  const [gitStatus, setGitStatus] = useState<{
    available: boolean;
    initialized: boolean;
    branch: string;
    changedFiles: string[];
    commits: Array<{
      hash: string;
      shortHash: string;
      author: string;
      dateIso: string;
      message: string;
    }>;
  } | null>(null);
  const [gitMsg, setGitMsg] = useState("");
  const [gitBusy, setGitBusy] = useState(false);

  // Item 25: Multi-user RBAC state
  const [usersList, setUsersList] = useState<
    Array<{
      id: string;
      username: string;
      role: string;
      memberships: Array<{ workspaceId: string; workspaceSlug: string; role: string }>;
    }>
  >([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [userBusy, setUserBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (activeWorkspace) {
      fetch(`/api/workspaces/${encodeURIComponent(activeWorkspace.slug)}/git`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setGitStatus(d);
        })
        .catch(() => {});
    }
    if (currentUser?.role === "admin") {
      fetch("/api/users")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.users) setUsersList(d.users);
        })
        .catch(() => {});
    }
  }, [open, activeWorkspace, currentUser]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-[#111114] p-5 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-base text-zinc-100">
            <Settings className="w-4 h-4 text-emerald-400" />
            <span>AI Providers &amp; Vault Backup</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Vault Export / Backup */}
        {activeWorkspace && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-zinc-100">
                Portable Backup &amp; Export ({activeWorkspace.name})
              </div>
              <div className="text-zinc-400 mt-0.5">
                Root path: <code className="text-zinc-300">{activeWorkspace.root_path}</code>
              </div>
            </div>
            <a
              href={`/api/workspaces/${encodeURIComponent(activeWorkspace.slug)}/export?saveSnapshot=true`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 text-zinc-100 font-medium"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Export Vault Backup JSON
            </a>
          </div>
        )}

        {/* Modular Provider Status & Credentials */}
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-blue-400" />
              <span>AI Provider Backends (Server-Side Encrypted Storage)</span>
            </h3>
            {savedNotice && (
              <span className="text-emerald-400 font-medium">{savedNotice}</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => {
              const isEditing = editingId === p.id;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-zinc-100">{p.name}</div>
                      <div className="text-[10px] text-zinc-400">
                        Auth: {p.authMode} • Billing: {p.billingModel}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        p.available
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {p.available ? "Ready" : "Unavailable"}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-300">{p.statusDetail}</p>
                  <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
                    {p.setupGuide}
                  </p>

                  {p.authMode !== "none" && (
                    <div>
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(p.id);
                            setSecret("");
                            setEndpointUrl(p.endpointUrl || "");
                            setModelName(p.modelName || "");
                          }}
                          className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          Configure {p.hasSecret ? "(Key Saved)" : "Credentials / Model"} →
                        </button>
                      ) : (
                        <div className="space-y-2 pt-2 border-t border-zinc-800">
                          {(p.authMode === "api-key" ||
                            p.id === "github-copilot" ||
                            p.id === "jetbrains-junie") && (
                            <input
                              type="password"
                              value={secret}
                              onChange={(e) => setSecret(e.target.value)}
                              placeholder={
                                p.hasSecret
                                  ? "Enter new secret to replace saved key"
                                  : "Paste API key or fine-grained CLI token"
                              }
                              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
                            />
                          )}
                          {p.id === "ollama" && (
                            <input
                              value={endpointUrl}
                              onChange={(e) => setEndpointUrl(e.target.value)}
                              placeholder="http://127.0.0.1:11434"
                              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
                            />
                          )}
                          <input
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            placeholder="Model name override"
                            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                await onSaveProvider({
                                  providerId: p.id,
                                  enabled: true,
                                  ...(secret.trim() ? { secret } : {}),
                                  endpointUrl,
                                  modelName,
                                });
                                setEditingId(null);
                                setSavedNotice(`Saved ${p.name} config (AES-256-GCM)`);
                                setTimeout(() => setSavedNotice(""), 3000);
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-zinc-950 font-semibold text-[11px] cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-2.5 py-1 rounded border border-zinc-700 text-zinc-400 text-[11px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Item 21: Per-Vault Git Snapshot & Log */}
        {activeWorkspace && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-zinc-200">
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <span>Vault Git Snapshots ({activeWorkspace.slug})</span>
              </div>
              {gitStatus && (
                <span className="text-[11px] font-mono text-zinc-400">
                  {gitStatus.initialized
                    ? `branch: ${gitStatus.branch} • ${gitStatus.changedFiles.length} uncommitted`
                    : gitStatus.available
                      ? "Not initialized yet (first snapshot initializes Git)"
                      : "git CLI not installed"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                value={gitMsg}
                onChange={(e) => setGitMsg(e.target.value)}
                placeholder="Commit snapshot message (optional)..."
                className="flex-1 min-w-[200px] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-100"
              />
              <button
                type="button"
                disabled={gitBusy || gitStatus?.available === false}
                onClick={async () => {
                  if (!activeWorkspace) return;
                  setGitBusy(true);
                  try {
                    const res = await fetch(
                      `/api/workspaces/${encodeURIComponent(activeWorkspace.slug)}/git`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "x-csrf-token": csrfToken,
                        },
                        body: JSON.stringify({ message: gitMsg.trim() || undefined }),
                      },
                    );
                    const data = await res.json();
                    if (res.ok) {
                      setGitStatus(data);
                      setGitMsg("");
                      onNotify(
                        data.committed
                          ? `Git snapshot committed (${data.commitHash})`
                          : data.message || "Working tree clean",
                      );
                    } else {
                      onNotify(data.error || "Git snapshot failed");
                    }
                  } finally {
                    setGitBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 cursor-pointer"
              >
                <GitCommitHorizontal className="w-3.5 h-3.5" />
                {gitBusy ? "Committing..." : "Commit Snapshot"}
              </button>
            </div>

            {gitStatus && gitStatus.commits.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1 pt-1">
                {gitStatus.commits.map((c) => (
                  <div
                    key={c.hash}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-emerald-400 shrink-0">
                        {c.shortHash}
                      </span>
                      <span className="text-zinc-200 truncate">{c.message}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 shrink-0">
                      {c.dateIso.slice(0, 10)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Item 25: Multi-User Accounts & Per-Workspace RBAC */}
        {currentUser?.role === "admin" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-zinc-200">
              <Users className="w-4 h-4 text-purple-400" />
              <span>Multi-User Accounts &amp; Workspace RBAC</span>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newUsername.trim() || newPassword.length < 8) return;
                setUserBusy(true);
                try {
                  const res = await fetch("/api/users", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-csrf-token": csrfToken,
                    },
                    body: JSON.stringify({
                      action: "createUser",
                      username: newUsername.trim().toLowerCase(),
                      password: newPassword,
                      role: newRole,
                      workspaceSlug: activeWorkspace?.slug,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    onNotify(data.error || "Failed to create user");
                    return;
                  }
                  setNewUsername("");
                  setNewPassword("");
                  onNotify(`Created ${newRole} user "${data.user.username}"`);
                  const listRes = await fetch("/api/users");
                  if (listRes.ok) {
                    const listJson = await listRes.json();
                    setUsersList(listJson.users || []);
                  }
                } finally {
                  setUserBusy(false);
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2"
            >
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="username"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="password (min 8 chars)"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
              />
              <select
                value={newRole}
                onChange={(e) =>
                  setNewRole(e.target.value as "admin" | "editor" | "viewer")
                }
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100"
              >
                <option value="editor">Editor (Read &amp; Write)</option>
                <option value="viewer">Viewer (Read Only)</option>
                <option value="admin">Admin (Full Control)</option>
              </select>
              <button
                type="submit"
                disabled={userBusy || !newUsername.trim() || newPassword.length < 8}
                className="rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white cursor-pointer"
              >
                {userBusy ? "Adding..." : "Add User"}
              </button>
            </form>

            <div className="space-y-1.5">
              {usersList.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="font-medium text-zinc-100">{u.username}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 uppercase">
                      {u.role}
                    </span>
                  </div>
                  {activeWorkspace && u.id !== currentUser.id && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500">
                        {activeWorkspace.slug} role:
                      </span>
                      <select
                        value={
                          u.memberships.find((m) => m.workspaceSlug === activeWorkspace.slug)
                            ?.role || u.role
                        }
                        onChange={async (e) => {
                          const role = e.target.value as "admin" | "editor" | "viewer";
                          const res = await fetch("/api/users", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              "x-csrf-token": csrfToken,
                            },
                            body: JSON.stringify({
                              action: "assignRole",
                              userId: u.id,
                              workspaceSlug: activeWorkspace.slug,
                              role,
                            }),
                          });
                          if (res.ok) {
                            onNotify(
                              `Updated ${u.username} → ${role} on ${activeWorkspace.slug}`,
                            );
                            const refreshed = await fetch("/api/users");
                            if (refreshed.ok) {
                              setUsersList((await refreshed.json()).users || []);
                            }
                          }
                        }}
                        className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-200"
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
              {workspaces.length === 0 && null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
