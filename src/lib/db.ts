import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./config";

const globalForDb = globalThis as unknown as {
  __cortexDb?: DatabaseSync;
  __cortexDbPath?: string;
};

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT '#10b981',
  root_path TEXT NOT NULL,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  object_type TEXT NOT NULL DEFAULT 'note',
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_trashed INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, rel_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  workspace_id UNINDEXED,
  rel_path,
  title,
  tags,
  body,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS note_headings (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  slug TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_raw TEXT NOT NULL,
  target_norm TEXT NOT NULL,
  target_note_id TEXT,
  alias TEXT,
  heading TEXT,
  line_number INTEGER NOT NULL,
  context_snippet TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_norm ON note_links(workspace_id, target_norm);

CREATE TABLE IF NOT EXISTS note_chunks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_chunks_ws ON note_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_note_chunks_note ON note_chunks(note_id);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_folder_permissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK(permission IN ('allow', 'deny')),
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, folder_prefix),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  context_scope_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  tool_proposals_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  preview_diff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  provider_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '',
  action_status TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_configs (
  provider_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  encrypted_secret TEXT NOT NULL DEFAULT '',
  endpoint_url TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  line_number INTEGER NOT NULL DEFAULT 1,
  interval_days REAL NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  last_reviewed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_flashcards_ws_due ON flashcards(workspace_id, due_at);
CREATE INDEX IF NOT EXISTS idx_notes_ws_trashed_updated ON notes(workspace_id, is_trashed, is_pinned DESC, is_favorite DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_headings_note ON note_headings(note_id, start_line);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created ON ai_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_members (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workspace_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
`;

/** Return the initialized SQLite DatabaseSync singleton for the current CORTEX_DATA_DIR. */
export function getDb(): DatabaseSync {
  const targetPath = getDbPath();
  if (globalForDb.__cortexDb && globalForDb.__cortexDbPath === targetPath) {
    return globalForDb.__cortexDb;
  }
  if (globalForDb.__cortexDb) {
    try {
      globalForDb.__cortexDb.close();
    } catch {
      // ignore close errors on stale handle
    }
  }
  const db = new DatabaseSync(targetPath);
  db.exec(SCHEMA_SQL);
  globalForDb.__cortexDb = db;
  globalForDb.__cortexDbPath = targetPath;
  return db;
}

/** Close and reset cached DB handle (used by isolated test runs). */
export function resetDbHandle(): void {
  if (globalForDb.__cortexDb) {
    try {
      globalForDb.__cortexDb.close();
    } catch {
      // ignore
    }
    globalForDb.__cortexDb = undefined;
    globalForDb.__cortexDbPath = undefined;
  }
}
