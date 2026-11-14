"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Focus, Maximize2, RotateCcw, Route, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { GraphData, GraphNode } from "@/lib/types";

interface KnowledgeGraphProps {
  graph: GraphData;
  activeNoteId?: string | null;
  onSelectNote: (noteId: string) => void;
  compact?: boolean;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const TYPE_COLORS: Record<string, string> = {
  moc: "#10b981",
  project: "#3b82f6",
  daily: "#f59e0b",
  literature: "#a855f7",
  meeting: "#ec4899",
  server: "#06b6d4",
  kanban: "#14b8a6",
  note: "#94a3b8",
};

export function KnowledgeGraph({
  graph,
  activeNoteId,
  onSelectNote,
  compact = false,
}: KnowledgeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [orphansOnly, setOrphansOnly] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [showSemantic, setShowSemantic] = useState(true);
  const [showClusters, setShowClusters] = useState(true);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [zoom, setZoom] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  const computedPath = useMemo(() => {
    if (!pathFrom || !pathTo) return [];
    if (pathFrom === pathTo) return [pathFrom];
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) || []), e.source]);
    }
    const visited = new Set<string>([pathFrom]);
    const parent = new Map<string, string>();
    const queue = [pathFrom];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nxt of adj.get(curr) || []) {
        if (visited.has(nxt)) continue;
        visited.add(nxt);
        parent.set(nxt, curr);
        if (nxt === pathTo) {
          const out = [pathTo];
          let step: string | undefined = curr;
          while (step) {
            out.unshift(step);
            step = parent.get(step);
          }
          return out;
        }
        queue.push(nxt);
      }
    }
    return [];
  }, [graph.edges, pathFrom, pathTo]);

  const pathNodeSet = useMemo(() => new Set(computedPath), [computedPath]);
  const pathEdgeSet = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < computedPath.length - 1; i++) {
      const pair = [computedPath[i], computedPath[i + 1]].sort().join("::");
      set.add(pair);
    }
    return set;
  }, [computedPath]);

  const filtered = useMemo(() => {
    let nodes = graph.nodes;
    let edges = graph.edges;
    let semanticEdges = showSemantic ? graph.semanticEdges || [] : [];

    if (localOnly && activeNoteId) {
      const keep = new Set<string>([activeNoteId]);
      for (const e of edges) {
        if (e.source === activeNoteId) keep.add(e.target);
        if (e.target === activeNoteId) keep.add(e.source);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
      semanticEdges = semanticEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
    } else if (orphansOnly) {
      nodes = nodes.filter((n) => n.isOrphan);
      edges = [];
      semanticEdges = semanticEdges.filter(
        (e) =>
          nodes.some((n) => n.id === e.source) &&
          nodes.some((n) => n.id === e.target),
      );
    }

    return { nodes, edges, semanticEdges };
  }, [graph, orphansOnly, localOnly, activeNoteId, showSemantic]);

  const simRef = useRef<{
    nodes: SimNode[];
    panX: number;
    panY: number;
    zoom: number;
    dragNodeId: string | null;
    panning: boolean;
    lastX: number;
    lastY: number;
    moved: boolean;
    hoveredId: string | null;
  }>({
    nodes: [],
    panX: 0,
    panY: 0,
    zoom: 1,
    dragNodeId: null,
    panning: false,
    lastX: 0,
    lastY: 0,
    moved: false,
    hoveredId: null,
  });

  useEffect(() => {
    simRef.current.zoom = zoom;
  }, [zoom]);

  useEffect(() => {
    const count = filtered.nodes.length;
    const radius = Math.max(90, count * 14);
    const prevById = new Map(simRef.current.nodes.map((n) => [n.id, n]));

    simRef.current.nodes = filtered.nodes.map((n, idx) => {
      const prev = prevById.get(n.id);
      if (prev) {
        return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy };
      }
      const angle = (idx / Math.max(1, count)) * Math.PI * 2;
      return {
        ...n,
        x: Math.cos(angle) * radius * (0.4 + (idx % 3) * 0.25),
        y: Math.sin(angle) * radius * (0.4 + (idx % 3) * 0.25),
        vx: 0,
        vy: 0,
      };
    });
  }, [filtered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animId = 0;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(240, Math.floor(rect.width * dpr));
      canvas.height = Math.max(180, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const step = () => {
      const state = simRef.current;
      const nodes = state.nodes;
      const rect = container.getBoundingClientRect();
      const w = rect.width || 400;
      const h = rect.height || 300;

      // Force simulation tick
      const byId = new Map<string, SimNode>();
      for (const n of nodes) byId.set(n.id, n);

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        // Centering gravity
        a.vx += -a.x * 0.0028;
        a.vy += -a.y * 0.0028;

        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy + 16;
          if (distSq < 90000) {
            const repulse = 1200 / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * repulse;
            const fy = (dy / dist) * repulse;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }
      }

      for (const edge of filtered.edges) {
        const src = byId.get(edge.source);
        const dst = byId.get(edge.target);
        if (!src || !dst) continue;
        const dx = dst.x - src.x;
        const dy = dst.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ideal = compact ? 75 : 105;
        const spring = (dist - ideal) * 0.015;
        const fx = (dx / dist) * spring;
        const fy = (dy / dist) * spring;
        src.vx += fx;
        src.vy += fy;
        dst.vx -= fx;
        dst.vy -= fy;
      }

      for (const n of nodes) {
        if (state.dragNodeId === n.id) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= 0.84;
        n.vy *= 0.84;
        n.x += n.vx;
        n.y += n.vy;
      }

      // Render canvas
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(w / 2 + state.panX, h / 2 + state.panY);
        ctx.scale(state.zoom, state.zoom);

        // Topic Cluster Hulls
        if (showClusters && !compact && graph.clusters && graph.clusters.length > 0) {
          for (const cluster of graph.clusters) {
            const members = cluster.nodeIds
              .map((id) => byId.get(id))
              .filter((m): m is SimNode => Boolean(m));
            if (members.length < 2) continue;
            const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
            const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
            let maxR = 32;
            for (const m of members) {
              const dist = Math.hypot(m.x - cx, m.y - cy);
              if (dist + 26 > maxR) maxR = dist + 26;
            }
            ctx.beginPath();
            ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
            ctx.fillStyle = `${cluster.color}14`;
            ctx.fill();
            ctx.lineWidth = 1 / state.zoom;
            ctx.strokeStyle = `${cluster.color}44`;
            ctx.stroke();

            ctx.font = `600 ${Math.max(10, Math.round(11 / Math.sqrt(state.zoom)))}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = `${cluster.color}cc`;
            ctx.fillText(cluster.label, cx, cy - maxR - 6);
          }
        }

        const highlightId = state.hoveredId || activeNoteId || null;
        const connectedToHighlight = new Set<string>();
        if (highlightId) {
          connectedToHighlight.add(highlightId);
          for (const e of filtered.edges) {
            if (e.source === highlightId) connectedToHighlight.add(e.target);
            if (e.target === highlightId) connectedToHighlight.add(e.source);
          }
        }

        // Semantic Ghost Edges (dashed cyan)
        if (showSemantic && filtered.semanticEdges.length > 0) {
          ctx.save();
          ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);
          for (const se of filtered.semanticEdges) {
            const src = byId.get(se.source);
            const dst = byId.get(se.target);
            if (!src || !dst) continue;
            const isLit =
              !highlightId || se.source === highlightId || se.target === highlightId;
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(dst.x, dst.y);
            ctx.strokeStyle = isLit
              ? "rgba(34, 211, 238, 0.48)"
              : "rgba(34, 211, 238, 0.14)";
            ctx.lineWidth = 1.2 / state.zoom;
            ctx.stroke();
          }
          ctx.restore();
        }

        // Explicit Edges (+ Shortest Path highlighting)
        for (const e of filtered.edges) {
          const src = byId.get(e.source);
          const dst = byId.get(e.target);
          if (!src || !dst) continue;
          const pairKey = [e.source, e.target].sort().join("::");
          const onPath = pathEdgeSet.has(pairKey);
          const isLit =
            onPath ||
            (!highlightId && pathNodeSet.size === 0) ||
            e.source === highlightId ||
            e.target === highlightId;
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(dst.x, dst.y);
          ctx.strokeStyle = onPath
            ? "rgba(251, 191, 36, 0.95)"
            : isLit
              ? "rgba(52, 211, 153, 0.45)"
              : "rgba(113, 113, 122, 0.14)";
          ctx.lineWidth = onPath
            ? 2.8 / state.zoom
            : isLit
              ? 1.5 / state.zoom
              : 1 / state.zoom;
          ctx.stroke();
        }

        // Nodes
        for (const n of nodes) {
          const baseRadius = compact
            ? 5.5 + Math.min(4, n.degree)
            : 6.5 + Math.min(6, n.degree * 1.1);
          const onPath = pathNodeSet.has(n.id);
          const isLit =
            onPath ||
            (pathNodeSet.size === 0 && (!highlightId || connectedToHighlight.has(n.id)));
          const isActive = n.id === activeNoteId;
          const isHovered = n.id === state.hoveredId;
          const color = TYPE_COLORS[n.objectType] || TYPE_COLORS.note;

          ctx.globalAlpha = isLit ? 1 : 0.25;

          if (onPath) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, baseRadius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
            ctx.lineWidth = 2 / state.zoom;
            ctx.stroke();
          }

          if (n.isOrphan) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, baseRadius + 3, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(249, 115, 22, 0.55)";
            ctx.lineWidth = 1.4 / state.zoom;
            ctx.stroke();
          }

          if (isActive || isHovered) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, baseRadius + 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(n.x, n.y, baseRadius, 0, Math.PI * 2);
          ctx.fillStyle = onPath ? "#fbbf24" : isActive ? "#34d399" : color;
          ctx.fill();
          ctx.lineWidth = 1.4 / state.zoom;
          ctx.strokeStyle = "#09090b";
          ctx.stroke();

          if (!compact || isLit || state.zoom >= 1.1) {
            const label =
              n.title.length > 26 ? `${n.title.slice(0, 24)}...` : n.title;
            ctx.font = `${Math.max(10, Math.round(11.5 / Math.sqrt(state.zoom)))}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = isActive || isHovered || onPath ? "#ffffff" : "#d4d4d8";
            ctx.fillText(label, n.x, n.y + baseRadius + 13);
          }

          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }

      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [
    filtered,
    activeNoteId,
    compact,
    showSemantic,
    showClusters,
    graph.clusters,
    pathNodeSet,
    pathEdgeSet,
  ]);

  function screenToWorld(clientX: number, clientY: number) {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const state = simRef.current;
    const x = (clientX - rect.left - rect.width / 2 - state.panX) / state.zoom;
    const y = (clientY - rect.top - rect.height / 2 - state.panY) / state.zoom;
    return { x, y };
  }

  function findNodeAt(wx: number, wy: number): SimNode | null {
    const nodes = simRef.current.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = (compact ? 11 : 13) / simRef.current.zoom;
      const dx = n.x - wx;
      const dy = n.y - wy;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = findNodeAt(world.x, world.y);
    simRef.current.lastX = e.clientX;
    simRef.current.lastY = e.clientY;
    simRef.current.moved = false;
    if (hit) {
      simRef.current.dragNodeId = hit.id;
    } else {
      simRef.current.panning = true;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const state = simRef.current;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.moved = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;

    if (state.dragNodeId) {
      const world = screenToWorld(e.clientX, e.clientY);
      const node = state.nodes.find((n) => n.id === state.dragNodeId);
      if (node) {
        node.x = world.x;
        node.y = world.y;
      }
      return;
    }

    if (state.panning) {
      state.panX += dx;
      state.panY += dy;
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    const hit = findNodeAt(world.x, world.y);
    state.hoveredId = hit?.id || null;
    setHoveredNode(hit);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const state = simRef.current;
    const wasDragId = state.dragNodeId;
    const moved = state.moved;
    state.dragNodeId = null;
    state.panning = false;
    if (!moved && wasDragId) {
      onSelectNote(wasDragId);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function resetCamera() {
    simRef.current.panX = 0;
    simRef.current.panY = 0;
    setZoom(1);
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] select-none">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800/80 bg-[#101014]">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-medium text-zinc-200">
            {compact ? "Local Graph" : "Knowledge Graph"}
          </span>
          <span className="text-zinc-500">•</span>
          <span>{filtered.nodes.length} notes</span>
          <span className="text-zinc-500">•</span>
          <span>{filtered.edges.length} links</span>
        </div>

        <div className="flex items-center gap-1.5">
          {activeNoteId && (
            <button
              type="button"
              onClick={() => setLocalOnly((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border transition cursor-pointer ${
                localOnly
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Focus className="w-3 h-3" />
              1-Hop Focus
            </button>
          )}

          {!compact && (
            <>
              <button
                type="button"
                onClick={() => setShowSemantic((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border transition cursor-pointer ${
                  showSemantic
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                }`}
              >
                <Sparkles className="w-3 h-3" />
                Ghost ({graph.semanticEdges?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setShowClusters((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border transition cursor-pointer ${
                  showClusters
                    ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                }`}
              >
                Clusters ({graph.clusters?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setOrphansOnly((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border transition cursor-pointer ${
                  orphansOnly
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                }`}
              >
                Orphans Only
              </button>
            </>
          )}

          <button
            type="button"
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(2))))}
            className="p-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(2))))}
            className="p-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Reset view"
            onClick={resetCamera}
            className="p-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!compact && graph.nodes.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-zinc-800/70 bg-[#0d0d11] text-[11px]">
          <span className="inline-flex items-center gap-1 text-zinc-400 font-medium">
            <Route className="w-3.5 h-3.5 text-amber-400" />
            Path Finder:
          </span>
          <select
            aria-label="Path Start Note"
            value={pathFrom}
            onChange={(e) => setPathFrom(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 max-w-[170px]"
          >
            <option value="">From note...</option>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
          <span className="text-zinc-600">→</span>
          <select
            aria-label="Path Target Note"
            value={pathTo}
            onChange={(e) => setPathTo(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 max-w-[170px]"
          >
            <option value="">To note...</option>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
          {(pathFrom || pathTo) && (
            <button
              type="button"
              onClick={() => {
                setPathFrom("");
                setPathTo("");
              }}
              className="px-2 py-0.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Clear
            </button>
          )}
          {pathFrom && pathTo && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {computedPath.length > 0 ? (
                computedPath.map((pid, idx) => {
                  const node = graph.nodes.find((n) => n.id === pid);
                  return (
                    <React.Fragment key={pid}>
                      {idx > 0 && <span className="text-zinc-500">→</span>}
                      <button
                        type="button"
                        onClick={() => onSelectNote(pid)}
                        className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                      >
                        {node?.title || pid}
                      </button>
                    </React.Fragment>
                  );
                })
              ) : (
                <span className="text-rose-400">No link path between these notes</span>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} className="relative flex-1 min-h-[260px] overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            setZoom((z) =>
              Math.min(2.6, Math.max(0.35, Number((z + delta).toFixed(2)))),
            );
          }}
          className="w-full h-full block cursor-grab active:cursor-grabbing"
        />

        {hoveredNode && (
          <div className="pointer-events-none absolute left-3 bottom-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs shadow-lg max-w-xs">
            <div className="font-semibold text-zinc-100">{hoveredNode.title}</div>
            <div className="text-zinc-400 text-[11px] truncate">
              {hoveredNode.relPath} • {hoveredNode.degree} connections
            </div>
            {hoveredNode.isOrphan && (
              <div className="text-amber-400 text-[10px] mt-0.5">
                Orphaned note (no incoming/outgoing links)
              </div>
            )}
          </div>
        )}

        {!compact && (
          <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/80 px-2.5 py-1.5 text-[10px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> MOC
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Project
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Daily
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500" /> Server
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full border border-orange-500" /> Orphan
            </span>
            <Maximize2 className="w-3 h-3 text-zinc-500 ml-1" />
          </div>
        )}
      </div>
    </div>
  );
}
