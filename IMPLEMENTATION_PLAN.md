# CortexMD — Implementation Plan (`IMPLEMENTATION_PLAN.md`)

> **Phase 0 Deliverable** — Phased execution roadmap with explicit verification criteria per phase.

---

## Phase 0 — Research & Architecture (Current)
- [x] Use **REA** to analyze Obsidian (`app.asar`, `obsidian.asar`), Notion (`app.asar`), Logseq (`demo.logseq.com`), AFFiNE (`app.affine.pro`), NotebookLM (`notebooklm.google`), Capacities (`capacities.io`), and Anytype (`anytype.io`).
- [x] Research AI provider authentication and licensing (Google Gemini CLI/OAuth, GitHub Copilot CLI/OAuth, JetBrains Junie CLI, Ollama, and Local Hybrid fallback).
- [x] Author `RESEARCH.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, and `IMPLEMENTATION_STATUS.md`.

## Phase 1 — Foundation
- Initialize Next.js (TypeScript, App Router, Tailwind CSS v4) with `lucide-react`, `gray-matter`, `marked`, `vitest`.
- Implement `src/lib/db.ts` using `node:sqlite` (`DatabaseSync`) with WAL mode, full relational + FTS5 schema, and migrations.
- Implement `src/lib/auth.ts` (`scrypt` hashing, `HttpOnly` sessions, CSRF validation, rate limiting) and `/api/auth/*` endpoints.
- Implement `src/lib/storage.ts` with canonical path-jail enforcement, vault initialization, and rich interconnected starter vaults (`personal`, `homelab`, `ai-research`).
- Create `Dockerfile`, `docker-compose.yml`, `.env.example`, and `next.config.ts` (`serverExternalPackages: ['node:sqlite']`).
- **Verify:** `npx tsc --noEmit`, auth/DB unit tests, and initial build check.

## Phase 2 — Knowledge Management System
- Implement `src/lib/indexer.ts` (frontmatter parser, heading line-range extractor, `[[WikiLink]]` resolver, `#tag` extractor, unlinked mention scanner, orphan detector, incremental single-file indexing, `fs.watch` + reconciliation).
- Implement `/api/workspaces`, `/api/workspaces/import` (Obsidian vault importer), `/api/workspaces/[slug]/export`, `/api/notes`, `/api/attachments`, and `/api/search`.
- Implement Note Templates (`Blank`, `Daily Note`, `Project Spec`, `Meeting Note`, `Literature Note`, `Kanban Board`, `MOC`) and Tasks/Checklist aggregator.
- **Verify:** Unit/integration tests for indexing, links/backlinks, unlinked mentions, FTS5 + vector search, path traversal rejection, and Obsidian vault import.

## Phase 3 — AI Integration & RAG Pipeline
- Implement `src/lib/ai/embeddings.ts` (384-dim semantic feature hashing + cosine similarity).
- Implement `src/lib/ai/providers.ts` (Provider abstraction + `local-hybrid`, `gemini-cli`, `gemini-api`, `github-copilot`, `jetbrains-junie`, `ollama`).
- Implement `src/lib/ai/rag.ts` (Heading-based chunk retrieval, folder ACL filtering, prompt-injection sanitization, cross-workspace retrieval, contradiction/duplicate analysis, exact `path#Lstart-Lend` citations).
- Implement `/api/ai/providers`, `/api/ai/conversations`, `/api/ai/chat`.
- **Verify:** Automated tests verifying folder ACL exclusion, prompt-injection wrapping, multi-workspace citations, and provider status detection.

## Phase 4 — AI Agent & Controlled Tool System
- Implement `src/lib/ai/agent.ts` with read tools and approval-gated write tools (`create_note`, `edit_note`, `organize_note`, `update_metadata`, `auto_link_notes`) producing unified diffs.
- Implement `/api/ai/actions` (list, approve/apply with version snapshot + re-index, reject) and `/api/ai/audit` & `/api/ai/permissions`.
- **Verify:** Automated tests for tool proposal → diff generation → user approval → `.md` mutation → `note_versions` & `ai_audit_logs` verification + ACL block tests.

## Phase 5 — Interface, Graph Visualization, Sync & Offline PWA
- Build dark-first, Linear/Obsidian/Cursor-inspired three-pane UI:
  - Left Sidebar (Workspace switcher, Explorer tree, Tags, Object Types, Favorites, Recent, Tasks/Kanban, Trash, Settings).
  - Main Workspace (Multi-tab bar, Breadcrumbs, Frontmatter Properties editor, Live Split/Editor/Preview Markdown editor with `/` commands & `[[` autocomplete & line highlighting, Backlinks / Unlinked Mentions / Related Notes / Outline context tabs, Version History diff modal, Conflict Resolution modal).
  - Right AI Studio (Persistent chats, Scope selector, Provider selector, Clickable line-level citations, Agent Diff Approval Queue, Audit Log, Folder ACL manager).
  - Interactive Canvas Force-Directed Knowledge Graph (Global + Local 1-hop/2-hop, pan/zoom/drag, neighbor highlighting, orphan toggle).
  - Global Command Palette (`Ctrl+K`).
  - SSE real-time updates (`/api/events`) + PWA (`manifest.json`, `sw.js`, offline cache & edit queue reconciliation).
- **Verify:** Production build + live browser scenario verification via REA.

## Phase 6 — Security Audit, Documentation & Final Verification
- Run complete security & regression suite (`npm test`, `npm run lint` / `tsc --noEmit`, `npm run build`).
- Author `PROXMOX_DEPLOYMENT.md` covering Proxmox LXC + Docker Compose setup, HDD backup/restore cron scripts, and reverse proxy/VPN (Tailscale / Caddy / Nginx) guidance.
- Update `IMPLEMENTATION_STATUS.md` with verified results.
