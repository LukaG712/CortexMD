# CortexMD

**A self-hosted, Markdown-first, AI-native personal knowledge management platform.**

CortexMD runs on your own homelab or Proxmox server as a single lightweight Next.js + SQLite (`node:sqlite`) monolith. All notes remain plain `.md` files on disk inside your vault directories—no proprietary lock-in, no third-party cloud sync conflicts, and built-in AI capabilities that work out of the box without mandatory paid API keys.

---

## Highlights

- **Markdown-First Source of Truth (Obsidian-inspired):**
  - Native `.md` vaults with YAML frontmatter, nested folders, templates, daily journals, pinned/favorite notes, and `/assets/` attachments.
  - `[[WikiLinks]]`, automatic backlinks, unlinked mentions with 1-click link conversion, automatic backlink refactoring on rename, and block/heading transclusion (`![[Note Name]]`, `![[Note#Heading]]`, `![[Note#^block-id]]`).
  - Interactive Knowledge Graph with 1-hop local view, shortest-path finder, semantic ghost links, and community clusters, plus JSON Canvas 1.0 (`.canvas`) spatial boards.
- **Structured Views & Active Recall (Notion / Anki-inspired):**
  - Interactive YAML Properties Grid, live `cortex-query` embedded tables/lists, Calendar & activity heatmap, drag-and-drop Kanban tasks (`status` / `priority`), and SM-2 spaced repetition flashcards (`Q:`/`A:`, `::`, `#card`).
- **Grounded AI Studio (NotebookLM / Cursor-inspired):**
  - Built-in zero-key **`local-hybrid`** engine combining SQLite FTS5 and 384-dimension semantic embeddings—plus optional support for `gemini-cli`, `github-copilot`, `jetbrains-junie`, `gemini-api`, and local `ollama`.
  - Streaming SSE chat with `#Lstart-Lend` line citations, hover citation previews, contradiction scan, Study Guides, FAQs, and Two-Host Audio Briefings with Web Speech API playback.
  - Inline `Ctrl+I` AI diff rewrites, URL/HTML web clipper (`Sources/*.md`), and approval-gated Vault Gardener & agent diffs enforced by per-folder AI ACLs (`allow`/`deny`).
- **Homelab Ops, Offline PWA & Multi-User RBAC:**
  - Real-time SSE multi-device sync, 3-way hunk-by-hunk merge conflict resolution, snapshot version history, and per-vault Git snapshot commits (`/api/workspaces/[slug]/git`).
  - Installable PWA with IndexedDB offline note mirror, offline command-palette search, Web Share Target, and bearer-token quick-capture webhook (`/api/capture`).
  - Multi-user accounts (`scrypt` passwords, HttpOnly sessions, CSRF protection) with per-workspace `admin` / `editor` / `viewer` RBAC roles.
- **Refined Workspace Craft & Engine Performance:**
  - **Dual Theme & Typography:** Switch anytime between **Obsidian Dark** and warm alabaster **Paper** theme, toggle **Pentagram `Aa` Editorial Serif** reading mode (`68ch` measure), and enter **Zen Focus** mode with a single click.
  - **Home Dashboard, Quest & Faceted Search:** **Notion-style Vault Home Dashboard** (`Home` view) with KPI stats, Quick Capture bar, Daily Streak tracker, and a 5-step interactive onboarding quest; **Airbnb-style faceted `Ctrl+K` Command Palette** (`mode`, `type`, `folder`, `tag`) with a live note inspector.
  - **Optimized Local AI & Indexing Engine:** Sublinear-TF cached embeddings, weighted FTS5 BM25 ranking, cached per-workspace ACLs, line-preserving >1,800-char chunk splitting, proximity-aware `[[WikiLink]]` target resolution, fast 1-hop local graph queries, and multi-turn conversation history in RAG.

---

## Quick Start

### Option 1 — Docker Compose (Recommended for Proxmox LXC / Homelab)

1. **Clone and configure environment variables:**
   ```bash
   git clone https://github.com/LukaG712/CortexMD.git
   cd CortexMD
   cp .env.example .env
   ```
   Open `.env` and replace `ADMIN_PASSWORD` and `APP_SECRET` (32+ random characters recommended) before exposing over your LAN or VPN.

2. **Start the container:**
   ```bash
   docker compose up -d --build
   ```

3. **Open CortexMD:**
   Visit `http://localhost:3000` (or `http://<server-ip>:3000`).  
   Default credentials from `.env.example` (if unchanged): `admin` / `cortex-admin-change-me`.

> Persistent Markdown vaults and the SQLite index are stored outside the container at `${CORTEX_HOST_DATA_PATH:-./data}` (mapped to `/data`), with optional backup storage at `${CORTEX_HOST_BACKUP_PATH:-./backups}`.

---

### Option 2 — Local Development (Node.js)

Requires **Node.js 22.5+ / 24+** (uses built-in `node:sqlite`) and `npm`.

```bash
git clone https://github.com/LukaG712/CortexMD.git
cd CortexMD
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

For production locally without Docker:

```bash
npm run build
npm start
```

---

### Option 3 — Standalone Offline Desktop App (Windows / macOS / Linux)

CortexMD runs completely standalone and 100% offline as a cross-platform desktop application (powered by Electron + embedded Next.js standalone + SQLite):

- **Zero Docker, zero external server needed.**
- **Zero API Keys required:** No third-party accounts, no credit cards, and no personal notes ever leave your machine.
- **Automatic single-user login:** Opens directly into your personal workspace without password prompts.
- **Native OS Vault location:** Stores your Markdown notes directly in `Documents/CortexMD/vaults/` so you can view, edit, or back them up anytime with any tool.
- **OS File Explorer Integration:** Native desktop menu option (`Bestand -> Open Kluis in Verkenner` or `Ctrl+O`) opens your vault directory directly in Windows Explorer, macOS Finder, or Linux file manager.

**0. Download pre-built installers:**
Pre-built desktop packages for Windows (`.exe`, `.zip`), macOS (`.dmg`, `.zip` for Apple Silicon & Intel), and Linux (`.AppImage`, `.deb`, `.tar.gz`) are published automatically via GitHub Actions on [GitHub Releases](https://github.com/LukaG712/CortexMD/releases).

**1. Run the desktop app locally:**
```bash
npm run desktop
```

**2. Build desktop packages for your operating system:**
```bash
npm run build:desktop

# Windows (.exe installer & standalone .zip)
npm run dist:win

# macOS (.dmg & .zip for Apple Silicon & Intel)
npm run dist:mac

# Linux (.AppImage, .deb, and .tar.gz)
npm run dist:linux
```

---

### Mobile & Android Experience (PWA vs APK)

CortexMD comes equipped with an offline-capable **Progressive Web App (PWA)**:
- **No side-loading or APK signing needed:** Simply visit your CortexMD server or local instance in Chrome or Firefox on Android (or Safari on iOS) and tap **"Install App"** / **"Add to Home Screen"**.
- It creates a native app icon in your app launcher, launches full-screen without browser bars, and caches your notes offline using IndexedDB.
- Supports the native **Web Share Target API** and Quick Capture webhook (`/api/capture`) from Android share intents or automation shortcuts.

---

## Markdown & Keyboard Cheatsheet

### Keyboard Shortcuts
- **`Ctrl+K` / `Cmd+K`** — Open Command Palette (Hybrid FTS5 + semantic search, saved smart searches, quick actions)
- **`Ctrl+I` / `Cmd+I`** — Inline AI Rewrite with side-by-side diff preview

### Linking & Transclusion
- Link note: `[[Project Roadmap]]`
- Embed full note: `![[Project Roadmap]]`
- Embed section or block: `![[Project Roadmap#Milestones]]` or `![[Project Roadmap#^block-id]]`

### Live Embedded Queries (`cortex-query`)
````markdown
```cortex-query
tag: #homelab
status: active
sort: updated desc
view: table
limit: 10
```
````

### Flashcards (SM-2 Spaced Repetition)
Create flashcards inside any Markdown note and review them in the **Cards** view:

```markdown
Q: What isolates Proxmox LXC backups?
A: Separate HDD dataset and incremental snapshots.

SM-2 :: SuperMemo-2 spaced repetition algorithm.

### Default Hash Algorithm #card
scryptSync with per-user 16-byte random salt.
```

### Diagrams & Math
- Diagrams using standard ` ```mermaid ` code fences
- LaTeX math via inline `$E = mc^2$` or block `$$ ... $$`

---

## Quick Capture Webhook (`/api/capture`)

Append quick notes from mobile shortcuts, Home Assistant, or cron scripts without logging into a browser session by setting `CORTEX_CAPTURE_TOKEN` in `.env`:

```bash
curl -X POST http://localhost:3000/api/capture \
  -H "Authorization: Bearer YOUR_CAPTURE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceSlug": "personal",
    "title": "Homelab Alert",
    "text": "Proxmox nightly backup completed.",
    "url": "https://pve.local:8006",
    "tags": ["homelab", "backup"],
    "target": "inbox"
  }'
```

Set `"target": "daily"` to append to `journals/YYYY-MM-DD.md` instead of `Inbox/Quick Captures.md`.

---

## AI Providers

CortexMD works out of the box using its local **`local-hybrid`** engine (zero external API keys required). You can optionally configure external or CLI-backed providers in `.env` or via the **Settings** modal inside the app:

- `local-hybrid` — Built-in SQLite FTS5 + 384-dim local embeddings
- `gemini-cli` — Local Google Gemini CLI integration
- `github-copilot` — GitHub Copilot integration (`COPILOT_GITHUB_TOKEN`)
- `jetbrains-junie` — JetBrains Junie integration (`JUNIE_API_KEY`)
- `gemini-api` — Google Gemini API (`GEMINI_API_KEY`)
- `ollama` — Self-hosted Ollama server (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`)

---

## Environment Variables (`.env`)

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `CORTEX_DATA_DIR` | Directory holding vaults & SQLite index | `./data` (`/data` in Docker) |
| `ADMIN_USERNAME` | Initial administrator username | `admin` |
| `ADMIN_PASSWORD` | Initial administrator password | `cortex-admin-change-me` |
| `APP_SECRET` | Secret for session signing & encrypted provider keys (32+ chars) | *(set in `.env`)* |
| `CORTEX_CAPTURE_TOKEN` | Bearer token for `POST /api/capture` quick-capture webhooks | *(empty = disabled)* |
| `GEMINI_API_KEY` | Optional Gemini API key | *(optional)* |
| `COPILOT_GITHUB_TOKEN` | Optional GitHub Copilot token | *(optional)* |
| `JUNIE_API_KEY` | Optional JetBrains Junie API key | *(optional)* |
| `OLLAMA_BASE_URL` | Ollama server endpoint | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Default Ollama model name | `llama3.2` |
| `TRUSTED_PROXY_AUTH_HEADER` | Reverse-proxy OAuth username header (e.g. Authentik / Authelia) | *(empty = disabled)* |

---

## Development & Verification Scripts

```bash
npm run dev    # Start Next.js development server
npm run lint   # Run TypeScript compiler check (tsc --noEmit)
npm test       # Run Vitest end-to-end test suite (19 tests in tests/platform.test.ts)
npm run build  # Build production Next.js bundle
npm start      # Serve production build
```

---

## Further Documentation

- [Architecture Overview](ARCHITECTURE.md)
- [Proxmox & Docker Deployment Guide](PROXMOX_DEPLOYMENT.md)
- [Research & Ecosystem Comparison](RESEARCH.md)
- [Implementation Plan](IMPLEMENTATION_PLAN.md)
- [Implementation Status](IMPLEMENTATION_STATUS.md)
