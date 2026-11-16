# CortexMD — System Architecture (`ARCHITECTURE.md`)

> **Phase 0 Deliverable** — Lightweight, modular-monolith architecture tailored for a **Proxmox LXC / Docker** host (4 vCPU, 8 GB RAM, 100 GB SSD + HDD backups).

---

## 1. Architectural Principles

1. **Filesystem is Source of Truth:** Every note lives as a standard UTF-8 `.md` file under `DATA_DIR/vaults/<workspace-slug>/` with optional YAML frontmatter. Stopping or deleting CortexMD never locks or alters user notes.
2. **SQLite is the High-Speed Index & Metadata Engine:** Using Node.js 24's built-in `node:sqlite` (`DatabaseSync` in WAL mode), a single embedded database (`DATA_DIR/cortex.db`) handles users, sessions, workspaces, FTS5 full-text search, parsed `[[WikiLinks]]`, chunk embeddings, version snapshots, AI conversations, pending approvals, folder ACLs, and audit logs. Zero external database containers needed.
3. **Zero-Config Default AI + Modular Provider Abstraction:** Works immediately with zero API keys via the **Local Hybrid Knowledge Engine** (FTS5 BM25 + 384-dim semantic vector retrieval + extractive/structured synthesis), while cleanly supporting external CLI/OAuth/API backends (`gemini-cli`, `github-copilot`, `jetbrains-junie`, `gemini-api`, `ollama`).
4. **Defense-in-Depth for Self-Hosted Personal Data:** Password hashing via `scrypt`, `HttpOnly` sessions, CSRF validation, strict canonical path-jail enforcement, AI folder ACL filtering *before* retrieval, untrusted-content sandboxing against prompt injection, and mandatory human approval for any AI file mutation.

---

## 2. High-Level System Diagram

```
+-------------------------------------------------------------------------+
|                    Browser / Tablet / Mobile PWA                        |
|  Three-Pane UI (Explorer | Tabbed Editor + Graph | AI Studio & Agent)   |
|  Offline Cache + Pending Edit Queue + SSE Real-Time Listener            |
+------------------------------------+------------------------------------+
                                     | HTTPS (Reverse Proxy / VPN / LAN)
                                     v
+-------------------------------------------------------------------------+
|               CortexMD Modular Monolith (Next.js 16 + Node 24)          |
|                                                                         |
|  +-----------------------+   +---------------------------------------+  |
|  | Auth & Security Gate  |   | Real-Time Event Bus (SSE /api/events) |  |
|  | scrypt + sessions +   |   +---------------------------------------+  |
|  | CSRF + Rate Limiter   |                                              |
|  +-----------------------+   +---------------------------------------+  |
|                              | Incremental Indexer + File Watcher    |  |
|  +-----------------------+   | - YAML Frontmatter & Tags             |  |
|  | Note & Vault Service  |<->| - [[WikiLinks]], Backlinks, Unlinked  |  |
|  | - Optimistic Concurrency  | - Headings w/ Line Numbers            |  |
|  | - Version Snapshots   |   | - 384-dim Chunk Embeddings            |  |
|  +-----------+-----------+   +-------------------+-------------------+  |
|              |                                   |                      |
|  +-----------v-----------+   +-------------------v-------------------+  |
|  | AI RAG & Agent Engine |   | Modular AI Provider Abstraction       |  |
|  | - Folder ACL Filter   |-->| [Local Hybrid] | [Gemini CLI OAuth]   |  |
|  | - Prompt-Inj Guard    |   | [Copilot CLI]  | [Junie CLI]          |  |
|  | - Diff Proposal Queue |   | [Gemini API]   | [Ollama / Local LLM] |  |
|  | - Audit Logger        |   +---------------------------------------+  |
+--------------+-----------------------------------+----------------------+
               |                                   |
               v                                   v
+------------------------------+   +--------------------------------------+
| Persistent Volume: /data     |   | /data/cortex.db (SQLite WAL + FTS5)  |
| /data/vaults/<slug>/*.md     |   | notes, notes_fts, note_links,        |
| /data/vaults/<slug>/assets/* |   | note_chunks, note_versions,          |
| /data/backups/*.json         |   | ai_folder_permissions, ai_audit_logs |
+------------------------------+   +--------------------------------------+
```

---

## 3. Data Model (`node:sqlite` Schema)

- **`users` & `sessions`**: Scrypt-hashed credentials, random 16-byte salt, SHA-256 hashed session token, CSRF secret, expiry timestamp.
- **`workspaces`**: Multi-vault support (`slug`, `name`, `description`, `icon`, `color`, `root_path`, `ai_enabled`).
- **`notes`**: Indexed mirror of `.md` files (`id`, `workspace_id`, `rel_path`, `title`, `folder`, `object_type`, `frontmatter_json`, `tags_json`, `body`, `word_count`, `sha256`, `is_favorite`, `is_pinned`, `is_trashed`, `mtime_ms`, `created_at`, `updated_at`).
- **`notes_fts`**: SQLite FTS5 virtual table (`porter unicode61`) indexing `rel_path`, `title`, `tags`, `body` for sub-10ms keyword + phrase queries with `bm25()` ranking and `snippet()`.
- **`note_headings`**: Hierarchical outline (`level`, `text`, `slug`, `start_line`, `end_line`) enabling deep section citations.
- **`note_links`**: Extracted `[[Target|Alias#Heading]]` graph edges (`source_note_id`, `target_raw`, `target_norm`, `target_note_id`, `line_number`, `context_snippet`).
- **`note_chunks`**: Heading-aligned Markdown chunks (`heading`, `start_line`, `end_line`, `content`, `embedding_json`) storing normalized 384-dim feature-hashed semantic vectors for instant cosine similarity retrieval & duplicate detection.
- **`note_versions`**: Full content snapshots (`sha256`, `content`, `summary`, `created_by`: `user` | `ai-agent` | `restore` | `import`, `created_at`).
- **`ai_folder_permissions`**: Per-workspace `allow` / `deny` prefix rules evaluated before RAG indexing/retrieval and before any AI tool read/write.
- **`ai_conversations` & `ai_messages`**: Persistent chat threads, provider selection, context scope (`workspace`, `all`, `note`, `folder`), structured `citations_json`, and linked `tool_proposals_json`.
- **`ai_pending_actions`**: Human-in-the-loop approval queue (`tool_name`, `args_json`, `preview_diff`, `status`: `pending` | `approved` | `rejected`).
- **`ai_audit_logs`**: Immutable ledger of every AI read/proposal/approval/rejection/execution.
- **`provider_configs`**: Server-side AES-256-GCM encrypted API keys/endpoints (derived from `APP_SECRET`) so secrets never touch client bundles.

---

## 4. Key Subsystems & Concurrency / Security Design

### 4.1 Path-Jail & File Integrity
- Every filesystem access resolves `path.resolve(workspaceRoot, relPath)` and validates `resolved === workspaceRoot || resolved.startsWith(workspaceRoot + path.sep)`. Any `..`, null byte, or symlink escape throws `403 Forbidden`.
- `.md` writes update the file on disk first, compute the new SHA-256, snapshot the previous revision into `note_versions`, run incremental `indexSingleFile()`, and emit an SSE event (`note:updated`).
- **Optimistic Concurrency:** `PUT /api/notes` checks `baseSha256` against the current on-disk/DB SHA-256. A mismatch returns `409 Conflict` along with the current server content and hash so the UI launches the **Conflict Resolution Modal** (`Keep Local`, `Take Server`, `Save Conflict Copy`).

### 4.2 Hybrid Search & Local Semantic Embeddings
- **Why Local 384-dim Feature Hashing + Subword N-Grams?** On a 4-vCPU / 8 GB RAM server without a dedicated GPU, running heavy transformer embedding models in Node consumes 1–2 GB RAM and slows indexing. Our deterministic 384-dim normalized bag-of-word-stems + character 3-gram/4-gram hashing + TF-IDF weighting (`src/lib/ai/embeddings.ts`) requires **< 5 MB RAM**, runs in **< 1 ms per chunk**, works offline/air-gapped, and pairs with SQLite FTS5 BM25 via Reciprocal Rank Fusion (RRF) for high-recall hybrid search.
- When an external provider (e.g. Ollama or Gemini API) is enabled, the same `AIProvider` interface seamlessly upgrades synthesis while keeping zero-latency local chunk retrieval and exact line-number citations.

### 4.3 AI Security & Prompt-Injection Defense
1. **Folder ACL Enforcement:** Any folder prefix marked `deny` (e.g., `Private/`, `Credentials/`) is excluded from `note_chunks` search results AND blocked inside `executeAgentTool`.
2. **Untrusted Content Isolation:** Retrieved Markdown snippets sent to any LLM/CLI backend are enclosed in `<untrusted_note_data path="..." lines="...">` tags alongside an explicit system instruction prohibiting instruction following from note text.
3. **Approval Gate:** AI mutating tools (`create_note`, `edit_note`, `organize_note`, `update_metadata`, `auto_link_notes`) **never** directly modify `.md` files. They generate a unified diff in `ai_pending_actions` that only applies after explicit user click of **Approve & Apply**.

---

## 5. Resource Budget (Proxmox 4 vCPU / 8 GB RAM / 100 GB SSD)

| Component | Expected Idle RAM | Peak RAM (5,000+ notes) | Disk Footprint |
| :--- | :--- | :--- | :--- |
| Next.js + Node 24 Server | ~95 MB | ~250–350 MB | ~180 MB (container) |
| SQLite (`cortex.db` + WAL) | OS page cache | ~30–120 MB | ~5–50 MB per 1,000 notes |
| Markdown Vaults + Assets | 0 MB | 0 MB | User data (`/data/vaults`) |
| Optional Local Ollama (if external) | Optional separate LXC | 2–4 GB | Separate model storage |
| **Total CortexMD Monolith** | **~100 MB** | **< 500 MB** | **< 1 GB app + notes** |
