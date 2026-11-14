"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Link2,
  Maximize2,
  Plus,
  Save,
  StickyNote,
  Trash2,
} from "lucide-react";
import { CanvasEdge, CanvasNode, JsonCanvasDoc, NoteSummary } from "@/lib/types";

interface SpatialCanvasViewProps {
  workspaceSlug: string;
  csrfToken: string;
  notes: NoteSummary[];
  onOpenNoteById: (noteId: string) => void;
  onNotify: (msg: string) => void;
}

const COLOR_STYLES: Record<string, { border: string; bg: string; badge: string }> = {
  "1": { border: "border-rose-500/50", bg: "bg-rose-950/30", badge: "#f43f5e" },
  "2": { border: "border-amber-500/50", bg: "bg-amber-950/30", badge: "#f59e0b" },
  "3": { border: "border-emerald-500/50", bg: "bg-emerald-950/30", badge: "#10b981" },
  "4": { border: "border-blue-500/50", bg: "bg-blue-950/30", badge: "#3b82f6" },
  "5": { border: "border-violet-500/50", bg: "bg-violet-950/30", badge: "#8b5cf6" },
  default: { border: "border-zinc-700", bg: "bg-[#121217]", badge: "#71717a" },
};

export function SpatialCanvasView({
  workspaceSlug,
  csrfToken,
  notes,
  onOpenNoteById,
  onNotify,
}: SpatialCanvasViewProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [activePath, setActivePath] = useState("");
  const [doc, setDoc] = useState<JsonCanvasDoc>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");

  const dragRef = useRef<
    | { kind: "pan"; startX: number; startY: number; origX: number; origY: number }
    | { kind: "node"; nodeId: string; startX: number; startY: number; origX: number; origY: number }
    | null
  >(null);

  async function loadCanvas(targetPath?: string) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ workspaceSlug });
      if (targetPath) qs.set("path", targetPath);
      const res = await fetch(`/api/canvas?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const loadedFiles = (data.files || []) as string[];
      setFiles(loadedFiles);

      if (data.canvas && data.activePath) {
        setActivePath(data.activePath);
        setDoc(data.canvas);
        setDirty(false);
      } else {
        // Seed an in-memory starter canvas linked to workspace notes
        const starterNodes: CanvasNode[] = [
          {
            id: "node-welcome",
            type: "text",
            x: 80,
            y: 80,
            width: 270,
            height: 140,
            color: "3",
            text: `# ${workspaceSlug} Spatial Canvas\nDrag cards freely, connect concepts, or embed Markdown notes.\nStored as standard JSON Canvas 1.0 (.canvas).`,
          },
          ...notes.slice(0, 2).map((n, idx) => ({
            id: `node-note-${idx + 1}`,
            type: "file" as const,
            x: 430,
            y: 60 + idx * 170,
            width: 260,
            height: 120,
            color: idx === 0 ? "4" : "5",
            file: n.relPath,
          })),
        ];
        const starterEdges: CanvasEdge[] =
          notes.length > 0
            ? [
                {
                  id: "edge-1",
                  fromNode: "node-welcome",
                  toNode: "node-note-1",
                  label: "links to",
                },
              ]
            : [];
        setActivePath("Overview.canvas");
        setDoc({ nodes: starterNodes, edges: starterEdges });
        setDirty(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCanvas();
  }, [workspaceSlug]);

  async function saveCanvas(customPath?: string, customDoc?: JsonCanvasDoc) {
    const pathToSave = customPath || activePath || "Overview.canvas";
    const docToSave = customDoc || doc;
    setSaving(true);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          workspaceSlug,
          path: pathToSave,
          canvas: docToSave,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to save canvas");
        return;
      }
      setFiles(data.files || []);
      setActivePath(data.path);
      setDoc(data.canvas);
      setDirty(false);
      onNotify(`Saved canvas ${data.path}`);
    } finally {
      setSaving(false);
    }
  }

  function addTextNode() {
    const id = `node-${Date.now().toString(36)}`;
    const next: CanvasNode = {
      id,
      type: "text",
      x: Math.round((-pan.x + 180) / zoom),
      y: Math.round((-pan.y + 120) / zoom),
      width: 250,
      height: 135,
      color: "default",
      text: "New concept or sticky note...",
    };
    setDoc((prev) => ({ ...prev, nodes: [...prev.nodes, next] }));
    setSelectedNodeId(id);
    setDirty(true);
  }

  function addFileNode(note: NoteSummary) {
    const id = `node-${Date.now().toString(36)}`;
    const next: CanvasNode = {
      id,
      type: "file",
      x: Math.round((-pan.x + 240) / zoom),
      y: Math.round((-pan.y + 160) / zoom),
      width: 250,
      height: 120,
      color: "4",
      file: note.relPath,
    };
    setDoc((prev) => ({ ...prev, nodes: [...prev.nodes, next] }));
    setSelectedNodeId(id);
    setNotePickerOpen(false);
    setDirty(true);
  }

  function removeNode(nodeId: string) {
    setDoc((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setDirty(true);
  }

  function handleNodeClickForEdge(nodeId: string) {
    if (!connectMode) {
      setSelectedNodeId(nodeId);
      return;
    }
    if (!connectSourceId) {
      setConnectSourceId(nodeId);
      return;
    }
    if (connectSourceId === nodeId) {
      setConnectSourceId(null);
      return;
    }
    const edge: CanvasEdge = {
      id: `edge-${Date.now().toString(36)}`,
      fromNode: connectSourceId,
      toNode: nodeId,
    };
    setDoc((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
    setConnectSourceId(null);
    setConnectMode(false);
    setDirty(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.kind === "pan") {
      setPan({ x: drag.origX + dx, y: drag.origY + dy });
    } else {
      const nextX = Math.round(drag.origX + dx / zoom);
      const nextY = Math.round(drag.origY + dy / zoom);
      setDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === drag.nodeId ? { ...n, x: nextX, y: nextY } : n,
        ),
      }));
      setDirty(true);
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  const selectedNode = doc.nodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="h-full flex flex-col bg-[#09090b] min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800 bg-[#0f0f13] shrink-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={activePath}
            onChange={(e) => loadCanvas(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
          >
            {files.length === 0 ? (
              <option value={activePath || "Overview.canvas"}>
                {activePath || "Overview.canvas"} (unsaved)
              </option>
            ) : (
              files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))
            )}
          </select>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newBoardName.trim()) return;
              const p = newBoardName.trim().endsWith(".canvas")
                ? newBoardName.trim()
                : `${newBoardName.trim()}.canvas`;
              setNewBoardName("");
              await saveCanvas(p, { nodes: [], edges: [] });
            }}
            className="flex items-center gap-1"
          >
            <input
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="New board.canvas"
              className="w-32 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-[11px] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 inline" />
            </button>
          </form>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={addTextNode}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 cursor-pointer"
          >
            <StickyNote className="w-3.5 h-3.5 text-emerald-400" />
            Text Card
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotePickerOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              Add Note Card
            </button>
            {notePickerOpen && (
              <div className="absolute right-0 mt-1 w-64 max-h-64 overflow-y-auto z-30 rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl p-1">
                {notes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => addFileNode(n)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-[11px] text-zinc-200 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate">{n.title}</span>
                    <span className="text-[10px] font-mono text-zinc-500 truncate">
                      {n.relPath}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setConnectMode((v) => !v);
              setConnectSourceId(null);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer ${
              connectMode
                ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            {connectMode
              ? connectSourceId
                ? "Click Target Node..."
                : "Click Source Node..."
              : "Connect"}
          </button>

          <button
            type="button"
            onClick={() => {
              setPan({ x: 40, y: 40 });
              setZoom(1);
            }}
            title="Reset zoom & pan"
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => saveCanvas()}
            disabled={saving}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg font-medium border cursor-pointer ${
              dirty
                ? "bg-emerald-600 text-zinc-950 border-emerald-500 hover:bg-emerald-500"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800"
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : dirty ? "Save .canvas*" : "Saved"}
          </button>
        </div>
      </div>

      {/* Infinite Canvas Viewport */}
      <div
        className="relative flex-1 overflow-hidden select-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(63, 63, 70, 0.45) 1px, transparent 1px)",
          backgroundSize: `${Math.round(24 * zoom)}px ${Math.round(24 * zoom)}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedNodeId(null);
            dragRef.current = {
              kind: "pan",
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={(e) => {
          const factor = e.deltaY > 0 ? 0.92 : 1.08;
          setZoom((z) => Math.max(0.4, Math.min(2, Number((z * factor).toFixed(2)))));
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
            Loading spatial canvas...
          </div>
        )}

        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
          className="absolute top-0 left-0 w-0 h-0"
        >
          {/* SVG Edges Layer */}
          <svg
            width="4000"
            height="4000"
            style={{ overflow: "visible" }}
            className="pointer-events-none absolute top-0 left-0"
          >
            <defs>
              <marker
                id="canvas-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
              </marker>
            </defs>
            {doc.edges.map((edge) => {
              const a = doc.nodes.find((n) => n.id === edge.fromNode);
              const b = doc.nodes.find((n) => n.id === edge.toNode);
              if (!a || !b) return null;
              const x1 = a.x + a.width / 2;
              const y1 = a.y + a.height / 2;
              const x2 = b.x + b.width / 2;
              const y2 = b.y + b.height / 2;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              return (
                <g key={edge.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#10b981"
                    strokeOpacity={0.65}
                    strokeWidth={2}
                    markerEnd="url(#canvas-arrow)"
                  />
                  {edge.label && (
                    <g>
                      <rect
                        x={mx - 36}
                        y={my - 10}
                        width={72}
                        height={20}
                        rx={6}
                        fill="#09090b"
                        stroke="#27272a"
                      />
                      <text
                        x={mx}
                        y={my + 4}
                        textAnchor="middle"
                        fill="#a1a1aa"
                        fontSize={10}
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Node Cards Layer */}
          {doc.nodes.map((node) => {
            const style = COLOR_STYLES[node.color || "default"] || COLOR_STYLES.default;
            const matchedNote =
              node.type === "file" && node.file
                ? notes.find(
                    (n) =>
                      n.relPath.toLowerCase() === node.file!.toLowerCase(),
                  )
                : null;
            const isSelected = selectedNodeId === node.id;
            const isConnectSrc = connectSourceId === node.id;

            return (
              <div
                key={node.id}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleNodeClickForEdge(node.id);
                  if (!connectMode) {
                    dragRef.current = {
                      kind: "node",
                      nodeId: node.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                    };
                  }
                }}
                className={`absolute rounded-xl border p-2.5 shadow-xl flex flex-col gap-1.5 backdrop-blur-sm cursor-grab active:cursor-grabbing ${style.bg} ${
                  isConnectSrc
                    ? "border-amber-400 ring-2 ring-amber-400/40"
                    : isSelected
                      ? "border-emerald-400 ring-1 ring-emerald-500/40"
                      : style.border
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-400 shrink-0">
                  <span className="font-mono uppercase tracking-wider">
                    {node.type === "file" ? "NOTE" : node.type}
                  </span>
                  <div className="flex items-center gap-1">
                    {matchedNote && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onOpenNoteById(matchedNote.id)}
                        title="Open Note"
                        className="text-blue-400 hover:text-blue-300 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeNode(node.id)}
                      title="Delete card"
                      className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {node.type === "file" ? (
                  <div className="flex-1 overflow-hidden">
                    <div className="text-xs font-semibold text-zinc-100 truncate">
                      {matchedNote?.title || node.file}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                      {node.file}
                    </div>
                    {matchedNote && matchedNote.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {matchedNote.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.2 rounded bg-zinc-800/80 text-[10px] text-emerald-300"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={node.text || ""}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDoc((prev) => ({
                        ...prev,
                        nodes: prev.nodes.map((n) =>
                          n.id === node.id ? { ...n, text: val } : n,
                        ),
                      }));
                      setDirty(true);
                    }}
                    className="flex-1 w-full bg-transparent resize-none text-xs text-zinc-200 focus:outline-none leading-relaxed"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Selected Node Color Strip */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-1.5 text-[11px] shadow-xl">
            <span className="text-zinc-400">Card Color:</span>
            {Object.entries(COLOR_STYLES).map(([key, st]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDoc((prev) => ({
                    ...prev,
                    nodes: prev.nodes.map((n) =>
                      n.id === selectedNode.id ? { ...n, color: key } : n,
                    ),
                  }));
                  setDirty(true);
                }}
                className="w-4 h-4 rounded-full border border-white/20 cursor-pointer"
                style={{ backgroundColor: st.badge }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
