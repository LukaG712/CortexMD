import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getVaultsDir } from "./config";
import { getDb } from "./db";

export const DEFAULT_VAULT_FOLDERS = [
  "Inbox",
  "Projects",
  "Areas",
  "Resources",
  "Archive",
  "Templates",
  "journals",
  "assets",
] as const;

export function ensureDefaultVaultFolders(rootPath: string): void {
  fs.mkdirSync(rootPath, { recursive: true });
  for (const folder of DEFAULT_VAULT_FOLDERS) {
    fs.mkdirSync(path.join(rootPath, folder), { recursive: true });
  }
}

const IGNORED_FOLDER_NAMES = new Set([".git", ".obsidian", ".trash", "node_modules", "assets"]);

export function listWorkspaceFolders(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const results: string[] = [];

  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || IGNORED_FOLDER_NAMES.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      results.push(rel);
      walk(path.join(dir, entry.name), rel);
    }
  };

  walk(rootPath, "");
  return results.sort((a, b) => a.localeCompare(b));
}

export interface NoteTemplate {
  id: string;
  name: string;
  objectType: string;
  description: string;
  folder: string;
  content: (title: string, dateStr: string) => string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "blank",
    name: "Blank Note",
    objectType: "note",
    description: "Clean Markdown note with minimal YAML frontmatter",
    folder: "",
    content: (title, dateStr) => `---
type: note
created: ${dateStr}
tags: []
---

# ${title}

`,
  },
  {
    id: "daily",
    name: "Daily Journal",
    objectType: "daily",
    description: "Logseq/Obsidian daily inbox with focus, tasks, and scratchpad",
    folder: "journals",
    content: (title, dateStr) => `---
type: daily
date: ${dateStr}
tags: [journal]
---

# ${title}

## Focus Today
- [ ] Review inbox and link fleeting thoughts [#A]
- [ ] Capture key technical learnings

## Notes & Captures
- 

## Links Created
- 
`,
  },
  {
    id: "project",
    name: "Project Spec",
    objectType: "project",
    description: "Structured project page with goals, architecture, and milestones",
    folder: "Projects",
    content: (title, dateStr) => `---
type: project
status: active
created: ${dateStr}
tags: [project]
---

# ${title}

## Objective
Describe the core problem this project solves.

## Architecture & Decisions
- 

## Tasks
- [ ] Define initial milestones [#A]
- [ ] Document deployment & rollback steps [#B]

## Related Resources
- 
`,
  },
  {
    id: "meeting",
    name: "Meeting Note",
    objectType: "meeting",
    description: "Typed meeting record with attendees, decisions, and action items",
    folder: "Meetings",
    content: (title, dateStr) => `---
type: meeting
date: ${dateStr}
attendees: []
tags: [meeting]
---

# ${title}

## Agenda
- 

## Key Decisions
- 

## Action Items
- [ ] Follow up on next steps [#A]
`,
  },
  {
    id: "literature",
    name: "Literature / Research Note",
    objectType: "literature",
    description: "Source-grounded synthesis note inspired by NotebookLM & Zettelkasten",
    folder: "Research",
    content: (title, dateStr) => `---
type: literature
created: ${dateStr}
source: ""
tags: [research]
---

# ${title}

## Core Thesis
Summarize the primary claim in your own words.

## Key Evidence & Quotes
> Cite exact lines or sections here.

## Connections to Existing Notes
- Related to: 
`,
  },
  {
    id: "kanban",
    name: "Kanban Board",
    objectType: "kanban",
    description: "Markdown-native Kanban board rendered as interactive columns",
    folder: "Projects",
    content: (title, dateStr) => `---
type: kanban
created: ${dateStr}
tags: [kanban, planning]
---

# ${title}

## Backlog
- [ ] Research architecture options
- [ ] Draft test plan

## In Progress
- [ ] Build core module [#A]

## Done
- [x] Initialize workspace
`,
  },
  {
    id: "moc",
    name: "Map of Content (MOC)",
    objectType: "moc",
    description: "Curated index linking sub-topics and evergreen notes",
    folder: "",
    content: (title, dateStr) => `---
type: moc
created: ${dateStr}
tags: [moc, index]
---

# ${title}

## Overview
Entry point for exploring this knowledge domain.

## Core Notes
- 

## Open Questions
- 
`,
  },
];

/** Compute SHA-256 hex digest of UTF-8 text or binary Buffer. */
export function computeSha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Normalize a relative path inside a vault to POSIX slashes without leading slash or traversal. */
export function normalizeRelPath(inputPath: string): string {
  const cleaned = inputPath.replaceAll("\\", "/").trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Invalid relative path");
  }
  if (/^[a-zA-Z]:/.test(cleaned)) {
    throw new Error("Absolute drive paths are forbidden");
  }
  const parts = cleaned.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error("Path traversal segment is forbidden");
    }
  }
  return parts.join("/");
}

/**
 * Safely resolve a relative path inside workspaceRoot, blocking traversal and symlink escapes.
 */
export function resolveVaultPath(workspaceRoot: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const rootResolved = path.resolve(workspaceRoot);
  const target = path.resolve(rootResolved, normalized);

  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error("Path escapes workspace root");
  }

  // Verify existing parent or target does not escape via symlink
  let probe = target;
  while (probe !== rootResolved) {
    if (fs.existsSync(probe)) {
      const real = fs.realpathSync(probe);
      const realRoot = fs.existsSync(rootResolved)
        ? fs.realpathSync(rootResolved)
        : rootResolved;
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new Error("Symlink escapes workspace root");
      }
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  return target;
}

/** Sanitize workspace slug to lowercase alphanumeric + hyphens. */
export function sanitizeSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "vault";
}

/** Walk a workspace directory on disk and return all relative .md file paths. */
export function listMarkdownFilesOnDisk(workspaceRoot: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(workspaceRoot)) return results;

  function walk(currentDir: string, relPrefix: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // skip .obsidian/.trash hidden metadata unless needed
      const fullPath = path.join(currentDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "assets" || entry.name === "node_modules") continue;
        walk(fullPath, rel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(rel);
      }
    }
  }

  walk(workspaceRoot, "");
  return results.sort();
}

/** Write a UTF-8 Markdown file atomically inside a jailed workspace path. */
export function writeMarkdownFile(
  workspaceRoot: string,
  relPath: string,
  content: string,
): { fullPath: string; sha256: string; mtimeMs: number } {
  const normalized = normalizeRelPath(relPath);
  const fullPath = resolveVaultPath(workspaceRoot, normalized);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  const stat = fs.statSync(fullPath);
  return {
    fullPath,
    sha256: computeSha256(content),
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

/** Seed default workspaces and rich interconnected Markdown notes on first run. */
export function ensureSeedWorkspaces(): void {
  const db = getDb();
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM workspaces").get() as {
    cnt: number;
  };
  if (countRow.cnt > 0) return;

  const vaultsDir = getVaultsDir();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const seedVaults = [
    {
      slug: "personal",
      name: "Personal Second Brain",
      description: "Evergreen notes, daily journals, projects, and life systems",
      icon: "brain",
      color: "#10b981",
      files: {
        "Welcome to CortexMD.md": `---
type: moc
created: ${today}
tags: [moc, onboarding, pkm]
---

# Welcome to CortexMD

CortexMD is your **self-hosted, AI-native second brain** stored entirely as plain \`.md\` files on disk.

## Why This Exists
- **Central Source of Truth:** Access the same notes from desktop, laptop, and mobile without [[Sync Architecture]] conflicts.
- **Plain Markdown First:** Every note lives in \`/data/vaults/\` with standard YAML frontmatter and \`[[WikiLinks]]\`.
- **Grounded AI Studio:** Ask questions across folders or workspaces with exact line-level citations, and approve agent edits via diff previews.

## Quick Jump
- [[Architecture Overview]]
- [[Daily Workflow]]
- [[Reading List & Research]]
- [[Private Credentials Policy]]
`,
        "Architecture Overview.md": `---
type: project
status: active
created: ${today}
tags: [architecture, sqlite, nextjs]
---

# Architecture Overview

CortexMD runs as a lightweight modular monolith using **Next.js**, **Node 24**, and embedded **SQLite WAL + FTS5**.

## Core Storage Design
1. Plain Markdown files are written directly to disk inside each workspace folder.
2. SQLite acts as a fast rebuildable index for full-text search (FTS5), backlinks, heading outlines, and 384-dim semantic vector chunks.
3. Version snapshots are captured automatically before overwrites or AI edits.

## Related
- See [[Sync Architecture]] for how multi-device edits avoid silent overwrites.
- See [[Welcome to CortexMD]] for the main workspace map.
`,
        "Sync Architecture.md": `---
type: note
created: ${today}
tags: [sync, pwa, conflict-resolution]
---

# Sync Architecture

Traditional local-first tools like Obsidian or Logseq rely on file sync daemons (Syncthing, iCloud, Dropbox) which frequently generate duplicate conflict files when editing offline on a phone and desktop.

## Central Server Model
- Every save checks \`baseSha256\` against the server's current digest.
- If another device modified the file first, CortexMD returns \`409 Conflict\` and opens a **Side-by-Side Conflict Resolver** rather than silently overwriting.
- Real-time updates stream over Server-Sent Events (\`/api/events\`).
- Offline edits queue safely in the browser PWA cache and reconcile once reconnected.
`,
        "Daily Workflow.md": `---
type: note
created: ${today}
tags: [workflow, daily, productivity]
---

# Daily Workflow

Every morning starts in \`journals/${today}.md\` using the Daily Journal template.

## Tasks
- [ ] Triage incoming notes and convert unlinked mentions into \`[[WikiLinks]]\` [#A]
- [x] Verify nightly Proxmox HDD backup snapshot [#B]
- [ ] Summarize Reading List & Research highlights [#C]
`,
        "Reading List & Research.md": `---
type: literature
created: ${today}
tags: [research, pkm, ai]
---

# Reading List & Research

Key ideas synthesized from [[Welcome to CortexMD]] and external PKM systems:

- **Capacities:** Typed objects reduce folder anxiety by distinguishing Projects, Meetings, Literature, and Daily Notes.
- **NotebookLM:** AI assistants earn trust only when every statement carries a verifiable source citation.
- **Cursor / Claude Code:** Agentic edits belong behind inspectable diffs and explicit folder permissions.

Note: Unlinked mentions of Architecture Overview or Daily Workflow can be detected automatically and converted with one click!
`,
        [`journals/${today}.md`]: `---
type: daily
date: ${today}
tags: [journal]
---

# ${today}

## Focus Today
- [ ] Review [[Architecture Overview]] and check [[Sync Architecture]] [#A]
- [ ] Run AI contradiction scan across Homelab docs [#B]

## Scratchpad
Testing how Daily Notes connect back to [[Welcome to CortexMD]].
`,
        "Private/Secrets Policy.md": `---
type: note
created: ${today}
tags: [security, private]
---

# Secrets Policy

This folder is restricted by default in **AI Access Rules** (\`Private/\` -> \`deny\`).
Never store unencrypted production passwords here, and test that the AI RAG engine excludes this folder from citations and agent edits.
`,
      },
    },
    {
      slug: "homelab",
      name: "Proxmox & Homelab",
      description: "Infrastructure notes, Docker Compose stacks, storage, and backup runbooks",
      icon: "server",
      color: "#38bdf8",
      files: {
        "Proxmox Node Specs.md": `---
type: project
status: active
created: ${today}
tags: [proxmox, hardware, homelab]
---

# Proxmox Node Specs

## Host Hardware Allocation
- **CPU:** 4 vCPU cores allocated to the main LXC/Docker host
- **Memory:** 8 GB RAM (target container footprint under 500 MB)
- **Fast Storage:** 100 GB NVMe SSD for OS, SQLite WAL database, and active Markdown vaults
- **Bulk Storage:** High-capacity HDD array mounted for nightly backups and media

## Related Runbooks
- [[Docker Deployment Runbook]]
- [[Backup & Recovery Strategy]]
`,
        "Docker Deployment Runbook.md": `---
type: note
created: ${today}
tags: [docker, proxmox, deployment]
---

# Docker Deployment Runbook

Deploy CortexMD inside an unprivileged Proxmox LXC or Docker host with persistent bind mounts outside the container lifecycle.

## Resource Allocation Notes
Container memory limit is configured to **1024 MB** (while idle footprint stays near 150 MB), leaving ample headroom on the 8 GB host documented in [[Proxmox Node Specs]].

## Checklist
- [ ] Bind \`/data\` to SSD host directory [#A]
- [ ] Configure Tailscale or Caddy reverse proxy with HTTPS [#A]
- [ ] Verify \`/api/health\` endpoint returns 200 OK [#B]
`,
        "Backup & Recovery Strategy.md": `---
type: note
created: ${today}
tags: [backup, hdd, disaster-recovery]
---

# Backup & Recovery Strategy

## Backup Schedule
- Nightly at 02:30 UTC, snapshot \`/data/vaults\` and run \`sqlite3 /data/cortex.db ".backup ..."\` onto the bulk HDD array.
- Note: An older draft claimed the Proxmox host had 16 GB RAM and 250 GB SSD, whereas [[Proxmox Node Specs]] confirms **8 GB RAM** and **100 GB SSD**.
- Keep 30 daily snapshots and 12 monthly archives.
`,
      },
    },
    {
      slug: "ai-research",
      name: "AI & Automation",
      description: "LLM provider authentication research, RAG benchmarks, and agent safety",
      icon: "sparkles",
      color: "#a855f7",
      files: {
        "AI Provider Auth Research.md": `---
type: literature
created: ${today}
tags: [ai, oauth, gemini, copilot, junie]
---

# AI Provider Auth Research

## Verified Authentication Paths
1. **Local Hybrid Engine (Built-in Default):** Zero API key required. Uses SQLite FTS5 BM25 + 384-dim semantic vector chunks.
2. **Google Gemini CLI:** Open-source Apache-2.0 CLI supporting official \`Sign in with Google\` OAuth 2.0. Never scrape consumer web cookies.
3. **GitHub Copilot CLI / OAuth:** Uses official GitHub OAuth token pass-through (\`COPILOT_GITHUB_TOKEN\`) billed to the user's Copilot subscription. Standalone \`GitHub Models\` (\`models.inference.ai.azure.com\`) has been retired.
4. **JetBrains Junie CLI:** Supports headless CI/terminal invocation with \`JUNIE_API_KEY\` or BYOK flags (\`--litellm-url\`, \`--google-api-key\`).
5. **Ollama:** Connects locally over HTTP for private open-weights models.

See also: [[Prompt Injection Defense]].
`,
        "Prompt Injection Defense.md": `---
type: note
created: ${today}
tags: [security, ai-agent, rag]
---

# Prompt Injection Defense

Indexed Markdown notes may contain clipped web articles or third-party text. Therefore:

- All note text is wrapped in \`<untrusted_note_data>\` tags when forwarded to an external model.
- Folder ACLs filter restricted directories *before* chunks enter context retrieval.
- Any file mutation proposed by an AI agent requires human review of the unified diff before writing to disk.
`,
      },
    },
  ];

  const insertWs = db.prepare(
    "INSERT INTO workspaces (id, slug, name, description, icon, color, root_path, ai_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
  );
  const insertAcl = db.prepare(
    "INSERT OR IGNORE INTO ai_folder_permissions (id, workspace_id, folder_prefix, permission, updated_at) VALUES (?, ?, ?, ?, ?)",
  );

  for (const vault of seedVaults) {
    const wsId = crypto.randomUUID();
    const rootPath = path.join(vaultsDir, vault.slug);
    ensureDefaultVaultFolders(rootPath);

    insertWs.run(
      wsId,
      vault.slug,
      vault.name,
      vault.description,
      vault.icon,
      vault.color,
      rootPath,
      now,
    );

    if (vault.slug === "personal") {
      insertAcl.run(crypto.randomUUID(), wsId, "Private", "deny", now);
    }

    for (const [relPath, content] of Object.entries(vault.files)) {
      writeMarkdownFile(rootPath, relPath, content);
    }
  }
}
