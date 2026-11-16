# CortexMD — Ecosystem Research & Reconnaissance (`RESEARCH.md`)

> **Phase 0 Deliverable** — Conducted using **REA** (Reverse Engineer Anything) across shipped local Electron ASAR artifacts (`Obsidian`, `Notion`) and live browser captures (`Logseq`, `AFFiNE`, `NotebookLM`, `Capacities`, `Anytype`), supplemented by official AI provider CLI/authentication verification.
>
> **Methodological Note:** All static ASAR observations reflect inert AST/inventory extraction (`shipped-artifact` authority); all browser observations reflect passive/scenario captures (`controlled-replay` authority).

---

## 1. REA Reconnaissance Inventory & Evidence Ledger

| Target | Inspection Method | Artifact / Origin | SHA-256 / Digest | REA Evidence IDs |
| :--- | :--- | :--- | :--- | :--- |
| **Obsidian Desktop (`app.asar`)** | `analyze_javascript_application` + `inspect_analysis_view` | `C:\Users\gosse\AppData\Local\Programs\Obsidian\resources\app.asar` | `f727888bd5346b83e8e8584b23f5dd6d6bb093fe11b28d3e413e3afe38f8b04c` | Parent: `ev_1f197f4d1dab7092127ffdaa21fe95293fdf7c296f47fb3f5d9c837fe73f3334`<br>Summary: `ev_0b8d8daaaff75a7d7e1b1709545a05fa3ee1432bb92ac0a394f674cfbcb1bf3e`<br>Modules: `ev_f24a007f54c6f603324ea4157a88b2bf36545692176662ebdd2c581c302924f6`<br>Facts: `ev_dd1a5487b83923f04dc66b6bec5afdee728e6635a0f2c57b005fecfa603e6831` |
| **Obsidian Core (`obsidian.asar`)** | `analyze_javascript_application` + `inspect_analysis_view` | `C:\Users\gosse\AppData\Local\Programs\Obsidian\resources\obsidian.asar` | `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780` | Parent: `ev_8f90cad44de7512af0c252177b0768c7743eb9ddaa2e73633a95d23d44083dd3`<br>Summary: `ev_7ed5c97a73b1294c9673f75dbaccbe2020c93f4eb0e1f6e870871b81936b7aa7`<br>Modules: `ev_f671470b847c6a7262ab31030f0868538537f036f109807dbdda35303d58ba98` |
| **Notion Desktop (`app.asar`)** | `analyze_javascript_application` + `inspect_analysis_view` | `C:\Users\gosse\AppData\Local\Programs\Notion\resources\app.asar` | `5441536efbdd16fc1119bed55a66e7034426195a282d3c6b9d593912770c6a54` | Parent: `ev_c1d4ff84141cdaed25a60a1167abacb8c38913293e7c6b5398e0cfa4cd49a3b2`<br>Summary: `ev_e35088079bad5e6e9893d0e29f090f3b17fa5aa55577cb339b468066fdd6b091`<br>Modules: `ev_2d53a69a97334b62a7b27e4da98dc46517ebd082861ca27a12e0f9c439695fa3`, `ev_4edfe95e900b9cf972b9d717b6b6a0e187a711efc89f65e8006631db84912491` |
| **Logseq Web Demo** | `capture_browser_scenario` | `https://demo.logseq.com/` | Scenario: `769f68c8d07ab921...` | `ev_da4c71180d983e1733f47774adb2a77a0c1361ce77d1a53e26870f9204613872` |
| **AFFiNE Live Workspace** | `capture_browser_scenario` | `https://app.affine.pro/` → `/workspace/...` | Scenario: `5e107daae38d6552...` | `ev_fc1b7809d392d908e17fbc513db021a3a893599e4501d7cb8f8aff0322422f34` |
| **NotebookLM / Gemini Notebook** | `capture_browser_scenario` | `https://notebooklm.google/` → `https://notebook.google/` | Scenario: `d881db4a251ed635...` | `ev_160eff5d4c4bf202ff1f157c27b11ce557ec5098a4c90390e24606c9beb304fb` |
| **Capacities** | `capture_browser_scenario` | `https://capacities.io/` | Scenario: `75689a69e54c3f5f...` | `ev_fb1f58d64be3ad7e1aad9d85bb7770fb70ea77cd81483994681a9b41cd455670` |
| **Anytype** | `capture_browser_scenario` | `https://anytype.io/` | Scenario: `c711f895f8ca8875...` | `ev_c868877825262bf5ecc052faf209d9644bdd59856b2fcf39fe5c9fcd989172ae` |

---

## 2. Deep-Dive Application Findings

### 2.1 Obsidian (`v1.14.5`)
- **What REA revealed in the shipped bundle:**
  - Minimal Electron shell (`app.asar` has only 27 inventoried files, loading `main.js` and `@electron/remote`, plus native `btime/binding.node` for file birth-time metadata and `get-fonts/binding.node`).
  - Core application (`obsidian.asar`, ~28.2 MB) runs an off-main-thread Web Worker (`worker.js`) for indexing and a dedicated physics simulation worker (`sim.js`) feeding a WebGL renderer (`lib/pixi.min.js`) for the knowledge graph.
  - Editor and rendering stack relies on CodeMirror (`lib/codemirror/codemirror.js`, `markdown.js`, `overlay.js`, `vim.js`), `lib/prism.min.js` for syntax highlighting, `lib/mermaid.min.js`, `lib/mathjax/obsidian-mathjax.js`, `lib/pdfjs/pdf.min.mjs`, and `lib/scrypt.js` (for E2EE sync key derivation).
  - Includes built-in web clipping/HTML-to-Markdown tooling (`lib/readability.js`, `lib/turndown.js`, `lib/defuddle.full.js`).
- **Strengths:** Plain `.md` files on disk, `[[WikiLinks]]`, backlinks, unlinked mentions, fast local graph, keyboard-driven command palette, zero vendor lock-in.
- **Shortcomings for our use case:** Requires paid Obsidian Sync or fragile third-party Syncthing/Git setups that produce sync conflict files (`sync-conflict-...md`) across laptop/phone; no native browser-first centralized source of truth; AI is bolted on via third-party community plugins that rely on paid API keys and lack a shared workspace-wide RAG index or safe approval workflow.

### 2.2 Notion Desktop
- **What REA revealed in the shipped bundle:**
  - Heavily modularized Electron wrapper (161 files in `app.asar`) maintaining a **local SQLite cache** via `better-sqlite3` (`.webpack/main/SqliteServer.js`, `.webpack/renderer/sqlite_browser/index.js`) so the web-backed workspace feels snappy and supports local caching.
  - Multi-tab & multi-window preload architecture (`.webpack/renderer/tabs/index.js`, `.webpack/renderer/windows_and_tabs/index.js`).
  - Built-in **`clientMcpHost`** (`clientMcpHost/host.js`, `worker.js`, `policy/windows.js`, `policy/shared.js`, `tools/fs.js`, `tools/validators.js`, `origin.js`, `capabilities.js`) — demonstrating how modern workspace apps isolate AI tool execution behind explicit policy validators, origin checks, and capability guards rather than giving agents raw filesystem access.
- **Strengths:** Polished workspace organization, clean sidebar hierarchy, structured properties/databases, slash commands, templates, tab management.
- **Shortcomings:** Proprietary cloud-locked block storage (not plain `.md` files), heavy cloud dependency, slow offline behavior, not self-hostable.

### 2.3 Logseq (`https://demo.logseq.com/`)
- **What REA captured in the live browser session:**
  - Runs a background `worker.js` with `lightning-fs.min.js` in browser or local directory mode, enforcing a clean 4-directory convention: `/journals` (daily notes), `/pages` (topic pages), `/assets` (attachments), and `/logseq/config.edn`.
  - Outliner-first UX: `Enter` creates a sibling block, `Shift+Enter` creates a newline, `/` triggers commands, `[[Page]]` links, `#tags`, task keywords (`NOW`, `LATER`, `TODO`, `DOING`, `DONE`) with priorities (`[#A]`, `[#B]`, `[#C]`).
  - **Signature UX Pattern:** `Shift+Click` opens any referenced page or block in the **right sidebar** while keeping the current page open, and automatically displays both **Linked References** and **Unlinked References**.
- **Shortcomings:** Strict bullet-only outliner forces every note into indented lists (awkward for long-form prose or technical docs); local-first sync across devices suffers the same conflict issues as Obsidian.

### 2.4 AFFiNE (`https://app.affine.pro/`)
- **What REA captured in the live browser session:**
  - Local-first/hybrid workspace powered by `nbstore-0.27.4.worker.js`, `npm-blocksuite` editor, `npm-jotai` state atoms, `npm-async-shiki` code highlighting, and `.webmcp/bridge.js`.
  - Clean sidebar taxonomy: Search, `All docs`, `Journals`, `Intelligence` (integrated AI chat), `Favorites`, `Organize` (folders), `Tags`, `Collections`, `Trash`, `Import`, `Template`.
  - Dual-mode toggle (Page vs. Edgeless whiteboard), `/` command menu, `@` mention menu (`docs | users | dates`), embedded Kanban & Table database views, collapsible **Table of Contents**, and **Bi-Directional Links** footer.
- **Shortcomings:** Stores documents inside binary Yjs/BlockSuite CRDT blobs rather than human-readable `.md` files; self-hosting full AFFiNE stack requires heavier PostgreSQL + Redis + sync server services.

### 2.5 NotebookLM / Gemini Notebook (`https://notebooklm.google/`)
- **What REA captured in the live browser session:**
  - Source-centric workspace where every AI answer is strictly grounded in user-supplied sources (17–267+ sources per notebook) rather than open-ended hallucination.
  - Inline clickable source citations paired with multi-format synthesis outputs: **Reports**, **Mind Maps**, **Data Tables**, **Flashcards**, **Quizzes**, **Infographics**, **Slide Decks**, and **Audio Overviews**.
- **Shortcomings:** Read-only against uploaded copies — the AI cannot edit your live Markdown notes, update tags/frontmatter, fix links, or act as a workspace maintainer.

### 2.6 Capacities (`https://capacities.io/`) & Anytype (`https://anytype.io/`)
- **Capacities:** Proves the value of **Object Types** (`Note`, `Project`, `Meeting`, `Book`, `Person`, `Daily Note`) to reduce folder anxiety ("Think in things, not files"), paired with the Daily Note as a frictionless inbox and automatic "Related Content" unlinked-mention discovery.
- **Anytype:** Strong typed object schemas and Table/Kanban/Gallery views over local-first P2P sync, but stores everything in opaque encrypted protobuf/DAG stores — zero plain-text Markdown portability if the app stops running.

---

## 3. Feature Comparison Matrix

| Dimension | Obsidian | Notion | NotebookLM | Logseq | AFFiNE | Anytype | Capacities | **CortexMD (Target)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Plain `.md` Files on Disk** | Yes | No | No | Yes (Outliner MD) | No (CRDT blobs) | No (Protobuf) | No (Export only) | **Yes (100% Native `.md`)** |
| **Central Server Source of Truth** | Paid Sync / DIY | Cloud SaaS | Cloud SaaS | Paid Sync / DIY | Self-host heavy | P2P / Node | Cloud SaaS | **Yes (Self-Hosted Monolith)** |
| **WikiLinks & Backlinks** | Excellent | Basic | No | Excellent | Good | Good | Excellent | **Yes + Line Snippets** |
| **Unlinked Mentions + 1-Click Link** | Yes | No | No | Yes | No | No | Yes (Pro) | **Yes (Built-in)** |
| **Interactive Knowledge Graph** | WebGL (`pixi.js`) | No | Mind Maps | Basic Graph | No | Basic Graph | Graph View | **Global + Local Graph** |
| **Typed Objects & Properties** | YAML Frontmatter | Databases | No | Properties | BlockSuite DB | Core Model | Core Model | **YAML Frontmatter + Object Types** |
| **Daily Notes & Tasks** | Core Plugin | Manual | No | Core | Journals | Daily | Core | **Built-in + Kanban/Task View** |
| **Grounded AI RAG w/ Citations** | Plugin only | Cloud AI | Best-in-class | Plugin only | Cloud AI | No | Cloud AI | **Built-in Section Citations** |
| **AI Agent File Editing + Approval** | No | Basic | No (Read-only) | No | No | No | No | **Yes (Diff Preview + ACL + Audit)** |
| **Zero-API-Key Free / CLI Auth** | No | Paid Add-on | Google Acct | No | Paid Add-on | No | Paid Add-on | **Built-in Hybrid + CLI/OAuth** |
| **Lightweight Proxmox Footprint** | Desktop only | Cloud SaaS | Cloud SaaS | Desktop only | Heavy Stack | Sync Node | Cloud SaaS | **~150–350 MB RAM SQLite Monolith** |

---

## 4. UX Patterns to Adopt vs. Features to Avoid

### Patterns Worth Adopting
1. **Obsidian's File-First Transparency & `[[WikiLinks]]`:** Every note is an ordinary `.md` file with YAML frontmatter; deleting the server leaves your entire knowledge base intact and readable in any editor.
2. **AFFiNE / Linear Three-Pane Restraint:** Clean dark-mode neutral surfaces (`#0B0D10` / `#12151B`), 1px subtle borders, emerald/cyan-blue accents, collapsible sidebars, multi-tab workspace, breadcrumbs, and instant `Ctrl+K` command palette.
3. **NotebookLM's Strict Grounded Citations:** Every AI claim links directly to `[Note Title § Heading (L12-L28)]`; clicking opens the note in a tab and highlights those exact lines.
4. **Logseq's Daily Inbox + Linked/Unlinked Reference Panel:** Instant Daily Note entry plus right/bottom context showing Backlinks, Unlinked Mentions with 1-click link conversion, and Task priorities.
5. **Capacities' Object-Type Badges:** Optional `object_type` (`note`, `daily`, `project`, `meeting`, `moc`, `kanban`) in YAML frontmatter lets notes act like structured objects without losing plain-text portability.
6. **Notion's `clientMcpHost` Policy Discipline:** AI tool execution is decoupled behind explicit folder allow/deny ACLs, path traversal guards, untrusted-content wrappers, and human-in-the-loop approval queues.

### Features to Avoid
- **Opaque proprietary storage** (Notion/Anytype/AFFiNE CRDT blobs) that locks user data inside databases.
- **Syncthing/file-sync conflicts** caused by multi-device local-first vaults without a central server coordinator.
- **Forced outliner-only editing** (Logseq) when writing long-form technical documentation.
- **Heavy microservice sprawl** (Kafka/Elasticsearch/Postgres+pgvector+Redis) on a 4-vCPU / 8 GB RAM Proxmox host.
- **Hard-coded paid API key requirements** or scraping consumer web cookies to impersonate APIs.

---

## 5. AI Provider Authentication & Licensing Research

| Provider / Backend | Official Auth Mechanism | Uses Existing Subscription Without Separate API Billing? | Headless / Server Integration Feasibility & Limitations |
| :--- | :--- | :--- | :--- |
| **1. Built-in Local Hybrid Engine (Default)** | None required (100% local) | Yes — completely free, zero external dependencies | **Production Default.** SQLite FTS5 BM25 + 384-dim semantic feature-hashing embeddings, heading-level citations, extractive multi-note synthesis, contradiction/duplicate detection, deterministic agent proposals. |
| **2. Google Gemini CLI (`@google/gemini-cli`)** | Official `Sign in with Google` (OAuth 2.0) or `GEMINI_API_KEY` | **Partially / Conditional:** Apache-2.0 CLI supports Google OAuth login with Code Assist Individual free tier (~1,000 req/day) and Google AI Pro/Ultra quotas (~1,500–2,000 req/day), though Google periodically adjusts consumer OAuth CLI routing vs. API Studio keys. | **Supported via Subprocess Adapter.** Server detects `gemini` binary & OAuth cache (`~/.gemini`), executes headless `gemini -p` prompts safely without browser scraping. Requires user to run `gemini` login once in the container shell. |
| **3. Google Gemini API (AI Studio)** | Official `GEMINI_API_KEY` | Free tier available via Google AI Studio (rate-limited, typically flash models) or pay-as-you-go. | **Supported via REST Adapter.** Encrypted key stored server-side only; zero browser exposure. |
| **4. GitHub Copilot CLI / OAuth** | GitHub OAuth (`gh` / `copilot` scope, `COPILOT_GITHUB_TOKEN`) | **Yes, for Copilot Subscribers:** Official Copilot CLI (`copilot`) / SDK accepts user GitHub OAuth token (`gho_...`) billed against the user's active Copilot Individual/Business/Enterprise quota. *Note:* Standalone free `GitHub Models` (`models.inference.ai.azure.com`) is retired. | **Supported via CLI/Token Adapter.** Detects `gh auth status` and `copilot` CLI on host. Note: GitHub Terms restrict wrapping Copilot into a multi-user public reselling service; intended strictly for personal self-hosted use by the authenticated subscriber. |
| **5. JetBrains Junie CLI** | `JUNIE_API_KEY`, JetBrains AI Pro/Ultimate auth, or BYOK flags | **Yes, for JetBrains AI Subscribers** (via JetBrains account / `--auth-license`) or BYOK (`--litellm-url`, `--google-api-key`, etc.). | **Supported via Subprocess Adapter.** Detects `junie` binary and executes headless tasks inside permitted vault directories. |
| **6. Ollama / OpenAI-Compatible Local LLM** | None or local bearer token | **Yes — 100% free & private** on local/LAN hardware. | **Supported via REST Adapter.** Connects to `http://localhost:11434` (or another Proxmox VM/LXC running Ollama). |

---

## 6. Proposed Feature Set & Product Identity ("CortexMD")

**CortexMD** unifies the best traits discovered during research into a single lightweight self-hosted monolith:
1. **Plain `.md` Vaults on Persistent Disk** + **SQLite WAL/FTS5/Vector Index** as a rebuildable cache & search engine.
2. **Three-Pane IDE-Grade Workspace:** Collapsible Left Navigation (Workspaces, Folder Tree, Tags, Object Types, Favorites, Recent, Trash), Tabbed Multi-Note Main Editor (Live Split/Editor/Preview, Frontmatter Properties Bar, `[[` Autocomplete, `/` Commands, Backlinks, Unlinked Mentions w/ 1-click linking, Related Notes, TOC), and Collapsible Right AI Studio.
3. **Interactive Global & Local Knowledge Graph:** Force-directed canvas with neighbor highlighting, orphan detection, and folder/type coloring.
4. **NotebookLM-Grade Grounded AI + Cursor-Grade Controlled Agent:** Works immediately via Built-in Local Hybrid Engine and optionally escalates synthesis to Gemini CLI (OAuth), Copilot CLI (OAuth), Junie CLI, Gemini API, or Ollama — always enforcing Folder ACLs, prompt-injection isolation, diff previews, explicit approval, and audit logs.
5. **Central Source-of-Truth Sync + Offline PWA:** Real-time SSE sync across devices, SHA-256 conflict detection modal, full version history snapshots, Obsidian Vault importer, and offline local cache + reconciliation.
