export interface WorkspaceItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  root_path: string;
  ai_enabled: number;
  created_at: number;
  note_count: number;
  trash_count: number;
}

export interface NoteTemplateItem {
  id: string;
  name: string;
  objectType: string;
  description: string;
  folder: string;
}

export interface NoteSummary {
  id: string;
  workspaceId: string;
  relPath: string;
  title: string;
  folder: string;
  objectType: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  wordCount: number;
  sha256: string;
  isFavorite: boolean;
  isPinned: boolean;
  isTrashed: boolean;
  mtimeMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDetail extends NoteSummary {
  body: string;
}

export interface HeadingItem {
  id: string;
  level: number;
  text: string;
  slug: string;
  start_line: number;
  end_line: number;
}

export interface OutgoingLinkItem {
  id: string;
  target_raw: string;
  target_norm: string;
  target_note_id: string | null;
  alias: string | null;
  heading: string | null;
  line_number: number;
  target_rel_path: string | null;
  target_title: string | null;
}

export interface BacklinkItem {
  id: string;
  source_note_id: string;
  source_path: string;
  source_title: string;
  heading: string | null;
  line_number: number;
  context_snippet: string;
  target_raw: string;
}

export interface UnlinkedMentionItem {
  sourceNoteId: string;
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number;
  snippet: string;
  matchedTerm: string;
}

export interface RelatedNoteItem {
  noteId: string;
  relPath: string;
  title: string;
  objectType: string;
  score: number;
  sharedTags: string[];
  sharedConcepts?: string[];
}

export interface VersionItem {
  id: string;
  sha256: string;
  summary: string;
  created_by: string;
  created_at: number;
  size_bytes: number;
  content: string;
}

export interface GraphNode {
  id: string;
  relPath: string;
  title: string;
  folder: string;
  objectType: string;
  tags: string[];
  degree: number;
  isOrphan: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface GraphSemanticEdge {
  source: string;
  target: string;
  score: number;
  sharedConcepts: string[];
}

export interface GraphCluster {
  id: string;
  label: string;
  color: string;
  nodeIds: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  semanticEdges?: GraphSemanticEdge[];
  clusters?: GraphCluster[];
  shortestPath?: string[];
}

export interface FlashcardItem {
  id: string;
  workspaceId: string;
  noteId: string;
  relPath: string;
  front: string;
  back: string;
  lineNumber: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  dueAt: number;
  lastReviewedAt: number | null;
  updatedAt: number;
}

export interface SavedSearchItem {
  id: string;
  workspaceId: string;
  name: string;
  query: string;
  createdAt: number;
}

export interface TaskItem {
  noteId: string;
  relPath: string;
  noteTitle: string;
  lineNumber: number;
  text: string;
  completed: boolean;
  status: "todo" | "doing" | "done";
  priority: "A" | "B" | "C" | null;
  tags: string[];
}

export interface SearchHit {
  noteId: string;
  workspaceSlug: string;
  relPath: string;
  title: string;
  folder: string;
  objectType: string;
  tags: string[];
  snippet: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
  matchType: string;
  score: number;
}

export type ProviderId =
  | "local-hybrid"
  | "gemini-cli"
  | "gemini-api"
  | "github-copilot"
  | "jetbrains-junie"
  | "ollama";

export interface ProviderStatusItem {
  id: ProviderId;
  name: string;
  authMode: "none" | "oauth-cli" | "api-key" | "local-http";
  billingModel: string;
  available: boolean;
  configured: boolean;
  hasSecret: boolean;
  modelName: string;
  endpointUrl: string;
  statusDetail: string;
  setupGuide: string;
}

export interface RagCitationItem {
  noteId: string;
  workspaceId: string;
  workspaceSlug: string;
  relPath: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

export interface PendingActionItem {
  id: string;
  conversationId: string;
  workspaceId: string;
  workspaceSlug?: string;
  toolName: string;
  args: Record<string, unknown>;
  previewDiff: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
}

export interface AiConversationItem {
  id: string;
  workspaceId: string | null;
  title: string;
  providerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessageItem {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations: RagCitationItem[];
  toolProposals: PendingActionItem[];
  createdAt: number;
}

export interface FolderPermissionItem {
  id: string;
  workspaceId: string;
  folderPrefix: string;
  permission: "allow" | "deny";
  updatedAt: number;
}

export interface AuditLogItem {
  id: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
  conversationId: string | null;
  providerId: string;
  toolName: string;
  targetPath: string;
  actionStatus: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface ConflictState {
  noteId: string;
  title: string;
  relPath: string;
  localContent: string;
  serverContent: string;
  serverSha256: string;
  serverUpdatedAt: number;
}

export interface OfflineQueuedEdit {
  noteId: string;
  workspaceSlug: string;
  relPath: string;
  title: string;
  content: string;
  baseSha256: string;
  queuedAt: number;
}

export interface TransclusionEntry {
  raw: string;
  found: boolean;
  noteId?: string;
  relPath?: string;
  title?: string;
  heading?: string;
  content: string;
}

export interface CortexQueryRowItem {
  noteId: string;
  relPath: string;
  title: string;
  objectType: string;
  values: Record<string, string>;
}

export interface CortexQueryResultItem {
  query: string;
  view: "table" | "list" | "tasks";
  fields: string[];
  rows: CortexQueryRowItem[];
  tasks: TaskItem[];
  totalMatched: number;
  error?: string;
}

export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  label?: string;
  color?: string;
}

export interface JsonCanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface AudioSegmentItem {
  speaker: "Host A" | "Host B";
  text: string;
}

export interface BriefingResultItem {
  title: string;
  studyGuideMarkdown: string;
  faqMarkdown: string;
  audioScriptMarkdown: string;
  audioSegments: AudioSegmentItem[];
  citations: RagCitationItem[];
  savedRelPath: string | null;
  savedNoteId: string | null;
  usedProvider: ProviderId;
}
