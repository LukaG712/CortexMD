"use client";

import { NoteDetail, NoteSummary, SearchHit } from "./types";

const IDB_NAME = "cortexmd_offline_v1";
const IDB_VERSION = 1;
const STORE_NOTES = "notes";
const STORE_LISTS = "note_lists";
const LS_NOTES_KEY = "cortexmd_note_cache_v1";
const LS_LISTS_KEY = "cortexmd_list_cache_v1";

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          db.createObjectStore(STORE_NOTES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_LISTS)) {
          db.createObjectStore(STORE_LISTS, { keyPath: "workspaceSlug" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function saveFallbackNote(note: NoteDetail): void {
  try {
    const cache = JSON.parse(localStorage.getItem(LS_NOTES_KEY) || "{}") as Record<
      string,
      NoteDetail
    >;
    cache[note.id] = note;
    localStorage.setItem(LS_NOTES_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage quota
  }
}

function readFallbackNote(noteId: string): NoteDetail | null {
  try {
    const cache = JSON.parse(localStorage.getItem(LS_NOTES_KEY) || "{}") as Record<
      string,
      NoteDetail
    >;
    return cache[noteId] || null;
  } catch {
    return null;
  }
}

export async function cacheNoteOffline(note: NoteDetail): Promise<void> {
  saveFallbackNote(note);
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NOTES, "readwrite");
      tx.objectStore(STORE_NOTES).put(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedNoteOffline(noteId: string): Promise<NoteDetail | null> {
  const db = await openIdb();
  if (db) {
    const fromIdb = await new Promise<NoteDetail | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NOTES, "readonly");
        const req = tx.objectStore(STORE_NOTES).get(noteId);
        req.onsuccess = () => resolve((req.result as NoteDetail | undefined) || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (fromIdb) return fromIdb;
  }
  return readFallbackNote(noteId);
}

export async function cacheNotesListOffline(
  workspaceSlug: string,
  notes: NoteSummary[],
): Promise<void> {
  try {
    const all = JSON.parse(localStorage.getItem(LS_LISTS_KEY) || "{}") as Record<
      string,
      NoteSummary[]
    >;
    all[workspaceSlug] = notes;
    localStorage.setItem(LS_LISTS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }

  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_LISTS, "readwrite");
      tx.objectStore(STORE_LISTS).put({ workspaceSlug, notes, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedNotesListOffline(
  workspaceSlug: string,
): Promise<NoteSummary[]> {
  const db = await openIdb();
  if (db) {
    const fromIdb = await new Promise<NoteSummary[] | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_LISTS, "readonly");
        const req = tx.objectStore(STORE_LISTS).get(workspaceSlug);
        req.onsuccess = () =>
          resolve(((req.result as { notes?: NoteSummary[] } | undefined)?.notes) || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (fromIdb) return fromIdb;
  }

  try {
    const all = JSON.parse(localStorage.getItem(LS_LISTS_KEY) || "{}") as Record<
      string,
      NoteSummary[]
    >;
    return all[workspaceSlug] || [];
  } catch {
    return [];
  }
}

/** Search cached notes and note metadata locally when offline or server is unreachable. */
export async function searchOfflineNotes(
  query: string,
  workspaceSlug: string,
): Promise<SearchHit[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const cachedNotes: NoteDetail[] = [];
  const db = await openIdb();
  if (db) {
    const idbAll = await new Promise<NoteDetail[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_NOTES, "readonly");
        const req = tx.objectStore(STORE_NOTES).getAll();
        req.onsuccess = () => resolve((req.result as NoteDetail[]) || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    cachedNotes.push(...idbAll);
  }

  if (cachedNotes.length === 0) {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_NOTES_KEY) || "{}") as Record<
        string,
        NoteDetail
      >;
      cachedNotes.push(...Object.values(raw));
    } catch {
      // ignore
    }
  }

  const hits: SearchHit[] = [];
  const seenIds = new Set<string>();

  for (const n of cachedNotes) {
    if (n.isTrashed) continue;
    const hay = `${n.title}\n${n.relPath}\n${n.tags.join(" ")}\n${n.body}`.toLowerCase();
    if (terms.length > 0 && !terms.every((t) => hay.includes(t))) continue;

    seenIds.add(n.id);
    const bodyLower = n.body.toLowerCase();
    const firstMatchIdx = terms[0] ? bodyLower.indexOf(terms[0]) : -1;
    const snippetStart = Math.max(0, firstMatchIdx - 60);
    const snippet = n.body.slice(snippetStart, snippetStart + 180).replace(/\s+/g, " ").trim();

    hits.push({
      noteId: n.id,
      workspaceSlug: workspaceSlug === "all" ? "personal" : workspaceSlug,
      relPath: n.relPath,
      title: n.title,
      folder: n.folder,
      objectType: n.objectType,
      tags: n.tags,
      snippet,
      matchType: "offline-cache",
      score: firstMatchIdx >= 0 ? 0.9 : 0.7,
    });
  }

  // Also include cached summaries not yet opened into full NoteDetail
  if (workspaceSlug !== "all") {
    const summaries = await getCachedNotesListOffline(workspaceSlug);
    for (const s of summaries) {
      if (seenIds.has(s.id) || s.isTrashed) continue;
      const hay = `${s.title} ${s.relPath} ${s.tags.join(" ")}`.toLowerCase();
      if (terms.length > 0 && !terms.every((t) => hay.includes(t))) continue;
      hits.push({
        noteId: s.id,
        workspaceSlug,
        relPath: s.relPath,
        title: s.title,
        folder: s.folder,
        objectType: s.objectType,
        tags: s.tags,
        snippet: `Cached metadata • ${s.wordCount} words`,
        matchType: "offline-index",
        score: 0.55,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 16);
}
