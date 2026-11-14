const EMBEDDING_DIMS = 384;

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
  "have", "has", "had", "not", "but", "what", "when", "where", "which", "who",
  "how", "why", "all", "any", "can", "will", "just", "into", "your", "our",
  "about", "more", "than", "then", "also", "been", "being", "their", "there",
  "they", "them", "these", "those", "does", "did", "doing", "each", "other",
  "such", "only", "over", "under", "very", "most", "some", "could", "should",
  "would", "make", "made", "using", "used", "use", "note", "notes",
]);

const CONCEPT_CLUSTERS: Record<string, string[]> = {
  containers: [
    "docker", "container", "containers", "compose", "podman", "kubernetes",
    "k8s", "helm", "dockerfile", "oci", "orchestration",
  ],
  virtualization: [
    "proxmox", "pve", "kvm", "qemu", "hypervisor", "lxc", "vm", "vms",
    "snapshot", "cluster", "homelab",
  ],
  networking: [
    "proxy", "nginx", "traefik", "caddy", "wireguard", "vpn", "dns",
    "ssl", "tls", "https", "vlan", "firewall", "tailscale",
  ],
  storage: [
    "zfs", "raid", "nvme", "ssd", "hdd", "backup", "backups", "restic",
    "borg", "pbs", "nas", "nfs", "smb", "mirror",
  ],
  database: [
    "sqlite", "fts5", "postgres", "postgresql", "sql", "schema", "index",
    "migration", "query", "dataview",
  ],
  "ai-rag": [
    "ai", "llm", "rag", "embedding", "embeddings", "semantic", "citation",
    "citations", "prompt", "agent", "gemini", "copilot", "ollama", "junie",
  ],
  security: [
    "auth", "authentication", "rbac", "csrf", "xss", "encryption", "aes",
    "scrypt", "oauth", "token", "secret", "secrets", "acl", "permission",
  ],
  knowledge: [
    "markdown", "obsidian", "logseq", "notion", "wikilink", "backlink",
    "backlinks", "graph", "transclusion", "pkm", "flashcard", "spaced", "canvas",
  ],
  frontend: [
    "react", "nextjs", "tailwind", "typescript", "pwa", "offline",
    "indexeddb", "editor", "mermaid", "latex",
  ],
  ops: [
    "git", "deploy", "deployment", "monitoring", "health", "cron", "sync",
    "webhook", "conflict",
  ],
};

const TERM_TO_CLUSTER = new Map<string, string[]>();
for (const [cluster, terms] of Object.entries(CONCEPT_CLUSTERS)) {
  for (const term of terms) {
    const arr = TERM_TO_CLUSTER.get(term) ?? [];
    arr.push(cluster);
    TERM_TO_CLUSTER.set(term, arr);
  }
}

function fnv1a(input: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function lightStem(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/(ations|ition|ation|ment|ness|able|ible|ing|ies|ied|ers|est|ly|ed|es|s)$/, (m) => {
      if (m === "ies" || m === "ied") return "y";
      return "";
    });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^a-z0-9_\-/]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Extract normalized semantic concept cluster IDs present in text.
 */
export function extractConceptTags(text: string): string[] {
  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) {
    const clusters = TERM_TO_CLUSTER.get(tok) || TERM_TO_CLUSTER.get(lightStem(tok));
    if (clusters) {
      for (const c of clusters) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}

/**
 * Explain shared semantic clusters and overlapping domain terms between two texts.
 */
export function explainSharedConcepts(textA: string, textB: string): string[] {
  const conceptsA = new Set(extractConceptTags(textA));
  const conceptsB = new Set(extractConceptTags(textB));
  const sharedClusters: string[] = [];
  for (const c of conceptsA) {
    if (conceptsB.has(c)) sharedClusters.push(c);
  }

  const stemsA = new Set(tokenize(textA).filter((w) => w.length >= 4).map(lightStem));
  const stemsB = new Set(tokenize(textB).filter((w) => w.length >= 4).map(lightStem));
  const sharedTerms: string[] = [];
  for (const s of stemsA) {
    if (stemsB.has(s) && !sharedClusters.includes(s)) {
      sharedTerms.push(s);
    }
  }

  return [...sharedClusters.slice(0, 3), ...sharedTerms.slice(0, 3)].slice(0, 6);
}

/**
 * Compute a lightweight L2-normalized 384-dim semantic embedding vector
 * combining stemmed tokens, domain concept clusters, bigrams, and character 3-grams.
 */
export function computeLocalEmbedding(text: string): number[] {
  const vec = new Float32Array(EMBEDDING_DIMS);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);

  const addFeature = (feature: string, weight: number) => {
    const h1 = fnv1a(feature, 2166136261);
    const h2 = fnv1a(feature, 3735928559);
    const idx = h1 % EMBEDDING_DIMS;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const stem = lightStem(tok);
    addFeature(`w:${stem}`, 1.8);
    addFeature(`r:${tok}`, 0.7);

    // Concept cluster expansion so semantically related vocabulary shares signal
    const clusters = TERM_TO_CLUSTER.get(tok) || TERM_TO_CLUSTER.get(stem);
    if (clusters) {
      for (const c of clusters) {
        addFeature(`k:${c}`, 2.1);
      }
    }

    // Bigram context
    if (i + 1 < tokens.length) {
      addFeature(`b:${stem}_${lightStem(tokens[i + 1])}`, 1.2);
    }

    // Subword char 3-grams for partial/morphological recall
    if (tok.length >= 4 && tok.length <= 24) {
      const padded = `^${tok}$`;
      for (let j = 0; j <= padded.length - 3; j++) {
        addFeature(`c:${padded.slice(j, j + 3)}`, 0.35);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIMS; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(5));
    }
  }

  return Array.from(vec);
}

/** Cosine similarity between two L2-normalized embedding vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
