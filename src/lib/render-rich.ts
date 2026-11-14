/**
 * Pure TypeScript / SSR-safe rich Markdown pre-processors and renderers:
 * - Item 1: Wiki-link note & heading transclusion (`![[Note]]`, `![[Note#Heading]]`)
 * - Item 2: Mermaid diagram -> dark-theme inline SVG (`flowchart`, `graph`, `sequenceDiagram`)
 *           and LaTeX math (`$...$`, `$$...$$`) -> semantic HTML spans/blocks
 */

const MEDIA_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|wav|m4a|ogg|webm|avif)$/i;

export interface TransclusionTarget {
  raw: string;
  target: string;
  heading?: string;
}

export function stripFrontmatterBlock(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const endIdx = normalized.indexOf("\n---\n", 4);
  if (endIdx !== -1) {
    return normalized.slice(endIdx + 5);
  }
  const endEof = normalized.indexOf("\n---", 4);
  if (endEof !== -1 && endEof + 4 === normalized.length) {
    return "";
  }
  return normalized;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHeadingKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Extracts either the body (without frontmatter) or a specific `# Heading` section
 * down to the next heading of the same or higher level. Fenced code blocks are ignored
 * when scanning for headings.
 */
export function extractHeadingSection(markdown: string, headingText?: string): string {
  const body = stripFrontmatterBlock(markdown).trim();
  if (!headingText || !headingText.trim()) {
    return body.length > 6000 ? `${body.slice(0, 6000)}\n\n...` : body;
  }

  const wanted = normalizeHeadingKey(headingText);
  const lines = body.split("\n");
  let inFence = false;
  let captureLevel = 0;
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;

    const level = match[1].length;
    const titleKey = normalizeHeadingKey(match[2]);

    if (startIdx === -1) {
      if (titleKey === wanted || titleKey.replace(/\s+/g, "-") === wanted.replace(/\s+/g, "-")) {
        startIdx = i;
        captureLevel = level;
      }
    } else if (level <= captureLevel) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return "";
  const section = lines.slice(startIdx, endIdx).join("\n").trim();
  return section.length > 6000 ? `${section.slice(0, 6000)}\n\n...` : section;
}

/**
 * Parses non-media `![[Note]]` and `![[Note#Heading]]` transclusion expressions
 * outside fenced code blocks and inline code spans.
 */
export function parseTransclusionTargets(markdown: string): TransclusionTarget[] {
  const seen = new Set<string>();
  const results: TransclusionTarget[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Mask inline code spans on this line before scanning embeds
    const strippedLine = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    const re = /!\[\[([^\]]+?)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(strippedLine)) !== null) {
      const inner = match[1].trim();
      const withoutAlias = inner.split("|")[0].trim();
      const hashIdx = withoutAlias.indexOf("#");
      const target = (hashIdx === -1 ? withoutAlias : withoutAlias.slice(0, hashIdx)).trim();
      const heading =
        hashIdx === -1 ? undefined : withoutAlias.slice(hashIdx + 1).trim() || undefined;
      if (!target || MEDIA_EXTENSION_RE.test(target)) continue;

      const raw = heading ? `${target}#${heading}` : target;
      const key = raw.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ raw, target, heading });
      }
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Mermaid SVG Renderer (Flowchart/Graph + Sequence Diagrams)                  */
/* -------------------------------------------------------------------------- */

type NodeShape = "rect" | "round" | "diamond" | "circle";

interface GraphNode {
  id: string;
  label: string;
  shape: NodeShape;
  layer: number;
  order: number;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  thick: boolean;
}

function parseNodeToken(token: string): { id: string; label?: string; shape?: NodeShape } {
  const clean = token.trim();
  const patterns: Array<{ re: RegExp; shape: NodeShape }> = [
    { re: /^([A-Za-z0-9_.-]+)\(\((.+?)\)\)$/, shape: "circle" },
    { re: /^([A-Za-z0-9_.-]+)\(\[(.+?)\]\)$/, shape: "round" },
    { re: /^([A-Za-z0-9_.-]+)\[\((.+?)\)\]$/, shape: "round" },
    { re: /^([A-Za-z0-9_.-]+)\{\{(.+?)\}\}$/, shape: "diamond" },
    { re: /^([A-Za-z0-9_.-]+)\{(.+?)\}$/, shape: "diamond" },
    { re: /^([A-Za-z0-9_.-]+)\[(.+?)\]$/, shape: "rect" },
    { re: /^([A-Za-z0-9_.-]+)\((.+?)\)$/, shape: "round" },
  ];

  for (const { re, shape } of patterns) {
    const m = re.exec(clean);
    if (m) {
      const label = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      return { id: m[1], label, shape };
    }
  }

  const bare = /^([A-Za-z0-9_.-]+)$/.exec(clean);
  if (bare) {
    return { id: bare[1] };
  }
  return { id: clean.replace(/[^A-Za-z0-9_.-]/g, "_") || "node", label: clean };
}

function ensureGraphNode(
  nodes: Map<string, GraphNode>,
  token: string,
): string {
  const parsed = parseNodeToken(token);
  const existing = nodes.get(parsed.id);
  if (!existing) {
    nodes.set(parsed.id, {
      id: parsed.id,
      label: parsed.label || parsed.id,
      shape: parsed.shape || "rect",
      layer: 0,
      order: 0,
    });
  } else {
    if (parsed.label) existing.label = parsed.label;
    if (parsed.shape) existing.shape = parsed.shape;
  }
  return parsed.id;
}

function renderFlowchartSvg(lines: string[], direction: "TD" | "LR"): string {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("%%") ||
      /^(subgraph\b|end\b|classDef\b|class\b|style\b|click\b|direction\b)/i.test(line)
    ) {
      continue;
    }

    // Match edge operators: -->|lbl|, -.->|lbl|, ==>|lbl|, -- lbl -->, -->, -.->, ==>, ---
    const edgeRe =
      /^(.+?)\s+(?:(--)\s+([^-\n]+?)\s+(-->)|(-\.->|==>|<-->|-->|---)(?:\|([^|]+)\|)?)\s+(.+)$/;
    const match = edgeRe.exec(line);

    if (match) {
      // Split chained targets if simple `A --> B --> C`
      const leftToken = match[1].trim();
      const midOp = match[4] || match[5] || "-->";
      const edgeLabel = (match[3] || match[6] || "").trim() || undefined;
      const rightRest = match[7].trim();

      // Check if rightRest itself has another edge operator
      const chainParts = [leftToken];
      const chainOps: Array<{ op: string; label?: string }> = [
        { op: midOp, label: edgeLabel },
      ];

      let cursor = rightRest;
      while (true) {
        const sub = /^(.+?)\s+(-\.->|==>|<-->|-->|---)(?:\|([^|]+)\|)?\s+(.+)$/.exec(cursor);
        if (!sub) {
          chainParts.push(cursor);
          break;
        }
        chainParts.push(sub[1].trim());
        chainOps.push({ op: sub[2], label: sub[3]?.trim() || undefined });
        cursor = sub[4].trim();
      }

      for (let i = 0; i < chainParts.length - 1; i += 1) {
        const fromId = ensureGraphNode(nodes, chainParts[i]);
        const toId = ensureGraphNode(nodes, chainParts[i + 1]);
        const opInfo = chainOps[i];
        edges.push({
          from: fromId,
          to: toId,
          label: opInfo.label,
          dashed: opInfo.op.includes("."),
          thick: opInfo.op.includes("="),
        });
      }
    } else if (/^[A-Za-z0-9_.-]+(\s*[\[\(\{].*[\]\)\}])?$/.test(line)) {
      ensureGraphNode(nodes, line);
    }
  }

  if (nodes.size === 0) {
    return `<pre class="cortex-mermaid-fallback">${escapeXml(lines.join("\n"))}</pre>`;
  }

  // Assign layers via longest-path DAG relaxation (bounded for cycles)
  const inDegree = new Map<string, number>();
  for (const id of nodes.keys()) inDegree.set(id, 0);
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const maxPasses = nodes.size + 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const e of edges) {
      if (e.from === e.to) continue;
      const fromNode = nodes.get(e.from);
      const toNode = nodes.get(e.to);
      if (fromNode && toNode && toNode.layer < fromNode.layer + 1 && toNode.layer < nodes.size) {
        toNode.layer = fromNode.layer + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group nodes by layer
  const layers = new Map<number, GraphNode[]>();
  for (const n of nodes.values()) {
    const bucket = layers.get(n.layer) ?? [];
    bucket.push(n);
    layers.set(n.layer, bucket);
  }
  const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);

  // Dimensions per node
  const nodeDims = new Map<string, { w: number; h: number }>();
  for (const n of nodes.values()) {
    const textLen = Math.max(n.label.length, 4);
    const w = Math.min(220, Math.max(92, textLen * 8.2 + 28));
    const h = n.shape === "diamond" ? 54 : n.shape === "circle" ? Math.min(90, Math.max(54, w * 0.6)) : 40;
    nodeDims.set(n.id, { w, h });
  }

  const layerGap = direction === "LR" ? 72 : 56;
  const siblingGap = 28;
  const pad = 28;

  const coords = new Map<string, { x: number; y: number; w: number; h: number }>();
  let cursorMajor = pad;
  let maxCross = 0;

  // First pass computes layer spans along cross-axis
  const layerSpans: number[] = [];
  for (const lk of sortedLayerKeys) {
    const bucket = layers.get(lk) ?? [];
    let span = 0;
    for (const n of bucket) {
      const dim = nodeDims.get(n.id)!;
      span += direction === "LR" ? dim.h : dim.w;
    }
    span += Math.max(0, bucket.length - 1) * siblingGap;
    layerSpans.push(span);
    if (span > maxCross) maxCross = span;
  }

  const totalCross = Math.max(180, maxCross + pad * 2);

  sortedLayerKeys.forEach((lk, idx) => {
    const bucket = layers.get(lk) ?? [];
    const span = layerSpans[idx];
    let majorMax = 0;
    for (const n of bucket) {
      const dim = nodeDims.get(n.id)!;
      majorMax = Math.max(majorMax, direction === "LR" ? dim.w : dim.h);
    }
    let crossCursor = (totalCross - span) / 2;

    for (const n of bucket) {
      const dim = nodeDims.get(n.id)!;
      if (direction === "LR") {
        coords.set(n.id, {
          x: cursorMajor + (majorMax - dim.w) / 2,
          y: crossCursor,
          w: dim.w,
          h: dim.h,
        });
        crossCursor += dim.h + siblingGap;
      } else {
        coords.set(n.id, {
          x: crossCursor,
          y: cursorMajor + (majorMax - dim.h) / 2,
          w: dim.w,
          h: dim.h,
        });
        crossCursor += dim.w + siblingGap;
      }
    }
    cursorMajor += majorMax + layerGap;
  });

  const width = direction === "LR" ? Math.max(260, cursorMajor - layerGap + pad) : totalCross;
  const height = direction === "LR" ? totalCross : Math.max(160, cursorMajor - layerGap + pad);

  const markerId = "cm-arrow-" + Math.abs(lines.join("").length % 10000);
  const edgeEls: string[] = [];
  for (const e of edges) {
    const a = coords.get(e.from);
    const b = coords.get(e.to);
    if (!a || !b) continue;

    let x1 = a.x + a.w / 2;
    let y1 = a.y + a.h;
    let x2 = b.x + b.w / 2;
    let y2 = b.y;
    let d: string;

    if (e.from === e.to) {
      x1 = a.x + a.w;
      y1 = a.y + a.h / 2;
      x2 = a.x + a.w / 2;
      y2 = a.y;
      d = `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2} ${y2 - 36}, ${x2} ${y2}`;
    } else if (direction === "LR") {
      x1 = a.x + a.w;
      y1 = a.y + a.h / 2;
      x2 = b.x;
      y2 = b.y + b.h / 2;
      const dx = (x2 - x1) * 0.5;
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    } else {
      if (y2 < y1) {
        // Back edge curves around side
        y1 = a.y + a.h / 2;
        y2 = b.y + b.h / 2;
        x1 = a.x + a.w;
        x2 = b.x + b.w;
        d = `M ${x1} ${y1} C ${x1 + 42} ${y1}, ${x2 + 42} ${y2}, ${x2} ${y2}`;
      } else {
        const dy = (y2 - y1) * 0.5;
        d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      }
    }

    const strokeDash = e.dashed ? ' stroke-dasharray="5 4"' : "";
    const strokeWidth = e.thick ? "2.6" : "1.6";
    edgeEls.push(
      `<path d="${d}" fill="none" stroke="#818cf8" stroke-width="${strokeWidth}"${strokeDash} marker-end="url(#${markerId})" />`,
    );

    if (e.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const lw = Math.max(34, e.label.length * 6.8 + 12);
      edgeEls.push(
        `<rect x="${mx - lw / 2}" y="${my - 10}" width="${lw}" height="20" rx="5" fill="#0f172a" stroke="#334155" stroke-width="1" />` +
          `<text x="${mx}" y="${my + 4}" text-anchor="middle" fill="#cbd5e1" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(e.label)}</text>`,
      );
    }
  }

  const nodeEls: string[] = [];
  for (const n of nodes.values()) {
    const c = coords.get(n.id)!;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const displayLabel = n.label.length > 26 ? `${n.label.slice(0, 24)}...` : n.label;
    let shapeSvg: string;
    if (n.shape === "diamond") {
      shapeSvg = `<polygon points="${cx},${c.y} ${c.x + c.w},${cy} ${cx},${c.y + c.h} ${c.x},${cy}" fill="#1e293b" stroke="#6366f1" stroke-width="1.6" />`;
    } else if (n.shape === "circle") {
      const r = Math.min(c.w, c.h) / 2;
      shapeSvg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e293b" stroke="#6366f1" stroke-width="1.6" />`;
    } else {
      const rx = n.shape === "round" ? Math.min(18, c.h / 2) : 7;
      shapeSvg = `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${rx}" fill="#1e293b" stroke="#6366f1" stroke-width="1.6" />`;
    }
    nodeEls.push(
      `<g>${shapeSvg}<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#f1f5f9" font-size="12.5" font-weight="500" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(displayLabel)}</text></g>`,
    );
  }

  return `<svg class="cortex-mermaid" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="100%" style="max-width:${Math.ceil(width)}px;height:auto;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" /></marker></defs>${edgeEls.join("")}${nodeEls.join("")}</svg>`;
}

function renderSequenceDiagramSvg(lines: string[]): string {
  const participants = new Map<string, string>();
  const events: Array<
    | { kind: "msg"; from: string; to: string; text: string; dashed: boolean }
    | { kind: "note"; targets: string[]; text: string }
  > = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) continue;

    const partMatch = /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (partMatch) {
      participants.set(partMatch[1], (partMatch[2] || partMatch[1]).trim());
      continue;
    }

    const noteMatch = /^Note\s+(?:over|left of|right of)\s+([A-Za-z0-9_,.\s-]+?)\s*:\s*(.+)$/i.exec(line);
    if (noteMatch) {
      const targets = noteMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const t of targets) {
        if (!participants.has(t)) participants.set(t, t);
      }
      events.push({ kind: "note", targets, text: noteMatch[2].trim() });
      continue;
    }

    const msgMatch = /^([A-Za-z0-9_.-]+)\s*(--?>>|--?>)\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (msgMatch) {
      const from = msgMatch[1];
      const arrow = msgMatch[2];
      const to = msgMatch[3];
      const text = msgMatch[4].trim();
      if (!participants.has(from)) participants.set(from, from);
      if (!participants.has(to)) participants.set(to, to);
      events.push({ kind: "msg", from, to, text, dashed: arrow.startsWith("--") });
    }
  }

  const pIds = [...participants.keys()];
  if (pIds.length === 0) {
    return `<pre class="cortex-mermaid-fallback">${escapeXml(lines.join("\n"))}</pre>`;
  }

  const colWidth = 156;
  const leftPad = 32;
  const topPad = 24;
  const boxH = 34;
  const boxW = 116;
  const rowH = 44;

  const width = Math.max(320, leftPad * 2 + pIds.length * colWidth);
  const height = topPad + boxH + 28 + Math.max(1, events.length) * rowH + 34;
  const markerId = "cm-seq-" + Math.abs(lines.join("").length % 10000);

  const xFor = (id: string) => {
    const idx = pIds.indexOf(id);
    return leftPad + idx * colWidth + colWidth / 2;
  };

  const partsSvg: string[] = [];
  for (const id of pIds) {
    const cx = xFor(id);
    const label = participants.get(id) || id;
    partsSvg.push(
      `<line x1="${cx}" y1="${topPad + boxH}" x2="${cx}" y2="${height - 20}" stroke="#334155" stroke-width="1.3" stroke-dasharray="4 4" />`,
      `<rect x="${cx - boxW / 2}" y="${topPad}" width="${boxW}" height="${boxH}" rx="6" fill="#1e293b" stroke="#6366f1" stroke-width="1.5" />`,
      `<text x="${cx}" y="${topPad + 21}" text-anchor="middle" fill="#f1f5f9" font-size="12" font-weight="600" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(label.slice(0, 18))}</text>`,
    );
  }

  const eventsSvg: string[] = [];
  events.forEach((ev, idx) => {
    const y = topPad + boxH + 34 + idx * rowH;
    if (ev.kind === "note") {
      const xs = ev.targets.map(xFor);
      const minX = Math.min(...xs) - 52;
      const maxX = Math.max(...xs) + 52;
      eventsSvg.push(
        `<rect x="${minX}" y="${y - 16}" width="${Math.max(110, maxX - minX)}" height="24" rx="4" fill="#1e1b4b" stroke="#6366f1" stroke-width="1" />`,
        `<text x="${(minX + Math.max(minX + 110, maxX)) / 2}" y="${y}" text-anchor="middle" fill="#e0e7ff" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(ev.text.slice(0, 42))}</text>`,
      );
      return;
    }

    const x1 = xFor(ev.from);
    const x2 = xFor(ev.to);
    const dash = ev.dashed ? ' stroke-dasharray="5 4"' : "";
    if (x1 === x2) {
      eventsSvg.push(
        `<path d="M ${x1} ${y - 6} H ${x1 + 38} V ${y + 12} H ${x1}" fill="none" stroke="#818cf8" stroke-width="1.5"${dash} marker-end="url(#${markerId})" />`,
        `<text x="${x1 + 44}" y="${y + 6}" text-anchor="start" fill="#cbd5e1" font-size="11.5" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(ev.text)}</text>`,
      );
    } else {
      const midX = (x1 + x2) / 2;
      eventsSvg.push(
        `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#818cf8" stroke-width="1.6"${dash} marker-end="url(#${markerId})" />`,
        `<text x="${midX}" y="${y - 7}" text-anchor="middle" fill="#cbd5e1" font-size="11.5" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(ev.text.slice(0, 40))}</text>`,
      );
    }
  });

  return `<svg class="cortex-mermaid" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" /></marker></defs>${partsSvg.join("")}${eventsSvg.join("")}</svg>`;
}

export function renderMermaidToSvg(code: string): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const firstMeaningful = lines.find((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("%%");
  })?.trim() ?? "";

  const flowMatch = /^(?:flowchart|graph)\s+(TD|TB|LR|RL)\b/i.exec(firstMeaningful);
  if (flowMatch || /^(?:flowchart|graph)\b/i.test(firstMeaningful)) {
    const dir = flowMatch && /^LR|RL$/i.test(flowMatch[1]) ? "LR" : "TD";
    const idx = lines.findIndex((l) => l.trim() === firstMeaningful);
    return renderFlowchartSvg(lines.slice(idx + 1), dir);
  }

  if (/^sequenceDiagram\b/i.test(firstMeaningful)) {
    const idx = lines.findIndex((l) => l.trim() === firstMeaningful);
    return renderSequenceDiagramSvg(lines.slice(idx + 1));
  }

  return `<div class="cortex-mermaid-card"><div class="cortex-mermaid-label">Mermaid Diagram</div><pre class="cortex-mermaid-fallback">${escapeXml(code.trim())}</pre></div>`;
}

/* -------------------------------------------------------------------------- */
/* LaTeX Math Renderer (`$$...$$` and `$...$`)                                */
/* -------------------------------------------------------------------------- */

const LATEX_SYMBOLS: Array<[RegExp, string]> = [
  [/\\alpha\b/g, "&alpha;"],
  [/\\beta\b/g, "&beta;"],
  [/\\gamma\b/g, "&gamma;"],
  [/\\delta\b/g, "&delta;"],
  [/\\epsilon\b/g, "&epsilon;"],
  [/\\varepsilon\b/g, "&epsilon;"],
  [/\\zeta\b/g, "&zeta;"],
  [/\\eta\b/g, "&eta;"],
  [/\\theta\b/g, "&theta;"],
  [/\\iota\b/g, "&iota;"],
  [/\\kappa\b/g, "&kappa;"],
  [/\\lambda\b/g, "&lambda;"],
  [/\\mu\b/g, "&mu;"],
  [/\\nu\b/g, "&nu;"],
  [/\\xi\b/g, "&xi;"],
  [/\\pi\b/g, "&pi;"],
  [/\\rho\b/g, "&rho;"],
  [/\\sigma\b/g, "&sigma;"],
  [/\\tau\b/g, "&tau;"],
  [/\\phi\b/g, "&phi;"],
  [/\\varphi\b/g, "&phi;"],
  [/\\chi\b/g, "&chi;"],
  [/\\psi\b/g, "&psi;"],
  [/\\omega\b/g, "&omega;"],
  [/\\Gamma\b/g, "&Gamma;"],
  [/\\Delta\b/g, "&Delta;"],
  [/\\Theta\b/g, "&Theta;"],
  [/\\Lambda\b/g, "&Lambda;"],
  [/\\Sigma\b/g, "&Sigma;"],
  [/\\Phi\b/g, "&Phi;"],
  [/\\Psi\b/g, "&Psi;"],
  [/\\Omega\b/g, "&Omega;"],
  [/\\sum\b/g, "&sum;"],
  [/\\prod\b/g, "&prod;"],
  [/\\int\b/g, "&int;"],
  [/\\infty\b/g, "&infin;"],
  [/\\approx\b/g, "&approx;"],
  [/\\neq\b/g, "&ne;"],
  [/\\leq\b/g, "&le;"],
  [/\\geq\b/g, "&ge;"],
  [/\\pm\b/g, "&plusmn;"],
  [/\\times\b/g, "&times;"],
  [/\\div\b/g, "&divide;"],
  [/\\cdot\b/g, "&middot;"],
  [/\\leftrightarrow\b/g, "&harr;"],
  [/\\rightarrow\b|\\to\b/g, "&rarr;"],
  [/\\leftarrow\b/g, "&larr;"],
  [/\\Rightarrow\b/g, "&rArr;"],
  [/\\in\b/g, "&isin;"],
  [/\\notin\b/g, "&notin;"],
  [/\\subseteq\b/g, "&sube;"],
  [/\\subset\b/g, "&sub;"],
  [/\\cup\b/g, "&cup;"],
  [/\\cap\b/g, "&cap;"],
  [/\\forall\b/g, "&forall;"],
  [/\\exists\b/g, "&exist;"],
  [/\\nabla\b/g, "&nabla;"],
  [/\\partial\b/g, "&part;"],
  [/\\ldots\b|\\dots\b/g, "&hellip;"],
  [/\\cdots\b/g, "&ctdot;"],
  [/\\left\b|\\right\b/g, ""],
];

function extractBracedGroup(src: string, startBraceIdx: number): { content: string; endIdx: number } | null {
  if (src[startBraceIdx] !== "{") return null;
  let depth = 0;
  for (let i = startBraceIdx; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: src.slice(startBraceIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
}

function replaceCommandTwoArgs(
  src: string,
  command: string,
  render: (a: string, b: string) => string,
): string {
  let out = src;
  let guard = 0;
  while (guard < 25) {
    guard += 1;
    const idx = out.indexOf(command);
    if (idx === -1) break;
    const afterCmd = idx + command.length;
    const firstStart = out.slice(afterCmd).search(/\{/);
    if (firstStart === -1) break;
    const g1 = extractBracedGroup(out, afterCmd + firstStart);
    if (!g1) break;
    const g2Search = out.slice(g1.endIdx + 1).search(/\{/);
    if (g2Search === -1) break;
    const g2 = extractBracedGroup(out, g1.endIdx + 1 + g2Search);
    if (!g2) break;
    out =
      out.slice(0, idx) +
      render(latexToHtml(g1.content), latexToHtml(g2.content)) +
      out.slice(g2.endIdx + 1);
  }
  return out;
}

function replaceCommandOneArg(
  src: string,
  command: string,
  render: (a: string) => string,
): string {
  let out = src;
  let guard = 0;
  while (guard < 25) {
    guard += 1;
    const idx = out.indexOf(command);
    if (idx === -1) break;
    const afterCmd = idx + command.length;
    const firstStart = out.slice(afterCmd).search(/\{/);
    if (firstStart === -1) break;
    const g1 = extractBracedGroup(out, afterCmd + firstStart);
    if (!g1) break;
    out = out.slice(0, idx) + render(latexToHtml(g1.content)) + out.slice(g1.endIdx + 1);
  }
  return out;
}

export function latexToHtml(tex: string): string {
  // Strip outer unsafe HTML chars first
  let out = escapeXml(tex.trim());

  // Multi-arg & single-arg commands
  out = replaceCommandTwoArgs(
    out,
    "\\frac",
    (num, den) =>
      `<span class="cortex-math-frac"><span class="cortex-math-num">${num}</span><span class="cortex-math-den">${den}</span></span>`,
  );
  out = replaceCommandOneArg(
    out,
    "\\sqrt",
    (arg) => `<span class="cortex-math-sqrt">&radic;<span class="cortex-math-rad">${arg}</span></span>`,
  );
  out = replaceCommandOneArg(out, "\\text", (arg) => `<span class="cortex-math-text">${arg}</span>`);
  out = replaceCommandOneArg(out, "\\mathrm", (arg) => `<span class="cortex-math-text">${arg}</span>`);
  out = replaceCommandOneArg(out, "\\mathbf", (arg) => `<strong>${arg}</strong>`);
  out = replaceCommandOneArg(out, "\\mathbb", (arg) => `<strong class="cortex-math-bb">${arg}</strong>`);

  // Superscripts and subscripts: ^{...} / ^x and _{...} / _x
  out = out.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>");
  out = out.replace(/\^([A-Za-z0-9])/g, "<sup>$1</sup>");
  out = out.replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>");
  out = out.replace(/_([A-Za-z0-9])/g, "<sub>$1</sub>");

  for (const [pattern, entity] of LATEX_SYMBOLS) {
    out = out.replace(pattern, entity);
  }

  return out;
}

/**
 * Replaces `$$...$$` display math and `$...$` inline math outside fenced code blocks
 * and inline code spans with styled `<div class="cortex-math-block">` and `<span class="cortex-math-inline">`.
 */
export function renderMathExpressions(markdown: string): string {
  const codeTokens: string[] = [];
  const mask = (raw: string) => {
    const token = `@@CMCODE_${codeTokens.length}@@`;
    codeTokens.push(raw);
    return token;
  };

  let text = markdown.replace(/\r\n/g, "\n");
  // Protect fenced code blocks first, then inline code spans
  text = text.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (m) => mask(m));
  text = text.replace(/`[^`\n]+`/g, (m) => mask(m));

  // Display math: $$ ... $$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => {
    return `\n<div class="cortex-math-block">${latexToHtml(inner)}</div>\n`;
  });

  // Inline math: $ ... $ (guards against currency like `$5 to $10`)
  text = text.replace(/(^|[^\\$])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g, (full, prefix: string, inner: string) => {
    if (/^\d[\d,.\s]*$/.test(inner.trim())) {
      return full;
    }
    return `${prefix}<span class="cortex-math-inline">${latexToHtml(inner)}</span>`;
  });

  // Unescape literal \$
  text = text.replace(/\\\$/g, "$");

  // Restore code tokens
  return text.replace(/@@CMCODE_(\d+)@@/g, (_m, idxStr: string) => codeTokens[Number(idxStr)] ?? "");
}
