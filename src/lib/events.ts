export interface PlatformEvent {
  type:
    | "note:updated"
    | "note:created"
    | "note:deleted"
    | "workspace:indexed"
    | "ai:action_proposed"
    | "ai:action_resolved";
  workspaceSlug: string;
  relPath?: string;
  noteId?: string;
  actionId?: string;
  timestamp: number;
}

type Listener = (event: PlatformEvent) => void;

const globalBus = globalThis as unknown as {
  __cortexListeners?: Set<Listener>;
};

function getListeners(): Set<Listener> {
  if (!globalBus.__cortexListeners) {
    globalBus.__cortexListeners = new Set();
  }
  return globalBus.__cortexListeners;
}

/** Broadcast a real-time workspace event to all connected SSE clients. */
export function broadcastEvent(event: Omit<PlatformEvent, "timestamp">): void {
  const full: PlatformEvent = { ...event, timestamp: Date.now() };
  for (const listener of getListeners()) {
    try {
      listener(full);
    } catch {
      // Ignore broken client stream listeners
    }
  }
}

/** Subscribe to real-time workspace events and return an unsubscribe callback. */
export function subscribeEvents(listener: Listener): () => void {
  const set = getListeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
