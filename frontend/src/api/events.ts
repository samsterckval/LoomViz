// Live updates from the back-end's file and git watchers (SPEC FR-9, FR-34) over `/ws/events`.

export type ServerEvent =
  { type: "files"; added: string[]; changed: string[]; deleted: string[]; other: boolean } | { type: "git" };

export interface ReloadPlan {
  /** Open files to re-read from disk (the buffer reducer decides: reload, keep, or ask). */
  reload: string[];
  /** Open files that no longer exist on disk. */
  deleted: string[];
  refreshTree: boolean;
  /** Re-render the active file (an image or template it may use changed). */
  rerender: boolean;
  refreshGit: boolean;
}

export function planReload(event: ServerEvent, openPaths: Set<string>, active: string | null): ReloadPlan {
  if (event.type === "git") {
    return { reload: [], deleted: [], refreshTree: false, rerender: false, refreshGit: true };
  }
  return {
    // "added" can also mean "re-created": reload it if it's open.
    reload: [...event.changed, ...event.added].filter((p) => openPaths.has(p)),
    deleted: event.deleted.filter((p) => openPaths.has(p)),
    refreshTree: event.added.length > 0 || event.deleted.length > 0,
    rerender: event.other && active !== null,
    refreshGit: true, // any change under loom/ can change the git status
  };
}

/** Connect to `/ws/events`, reconnecting with back-off. Returns a function that disconnects. */
export function connectEvents(
  token: string,
  onEvent: (event: ServerEvent) => void,
  onConnected?: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  let stopped = false;

  const open = () => {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(
      `${scheme}://${window.location.host}/ws/events?token=${encodeURIComponent(token)}`,
    );
    socket.onopen = () => {
      delay = 1000;
      onConnected?.(true);
    };
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as ServerEvent);
      } catch {
        // ignore malformed messages
      }
    };
    socket.onclose = () => {
      onConnected?.(false);
      if (stopped) return;
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
