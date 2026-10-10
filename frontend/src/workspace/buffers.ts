// Editor buffers: one per opened file (SPEC FR-8, FR-9). A buffer knows the text being edited,
// the text and ETag it was last synced with on disk, and whether disk and editor disagree.
// Pure reducer + persistence helpers, so the rules are unit-tested without React.

export interface Buffer {
  path: string;
  text: string; // editor content
  savedText: string; // content on disk when last loaded or saved
  etag: string; // ETag of savedText ("" = never saved, i.e. a new file)
  /** The file changed on disk while this buffer had unsaved edits: the user must choose. */
  conflict?: { diskText: string; diskEtag: string };
  /** The file was deleted on disk while this buffer had unsaved edits. */
  deletedOnDisk?: boolean;
}

export type Buffers = Record<string, Buffer>;

function without(state: Buffers, path: string): Buffers {
  const next = { ...state };
  delete next[path];
  return next;
}

export const isDirty = (b: Buffer | undefined): boolean =>
  !!b && (b.text !== b.savedText || !!b.deletedOnDisk);

export type BufferAction =
  /** File read from disk (opened, or re-read after a disk change). */
  | { type: "loaded"; path: string; text: string; etag: string }
  | { type: "edited"; path: string; text: string }
  | { type: "saved"; path: string; text: string; etag: string }
  /** The user chose between their edits and the disk version. */
  | { type: "resolved"; path: string; keep: "mine" | "disk" }
  | { type: "deletedOnDisk"; path: string }
  | { type: "renamed"; from: string; to: string }
  | { type: "closed"; path: string }
  | { type: "restored"; buffers: Buffers };

export function buffersReducer(state: Buffers, action: BufferAction): Buffers {
  switch (action.type) {
    case "loaded": {
      const current = state[action.path];
      if (!current || !isDirty(current)) {
        // Clean (or new): take the disk version.
        return {
          ...state,
          [action.path]: { path: action.path, text: action.text, savedText: action.text, etag: action.etag },
        };
      }
      if (action.etag === current.etag || action.text === current.text) {
        // Same version we already based our edits on, or the disk now matches our edits.
        const synced = action.text === current.text;
        return {
          ...state,
          [action.path]: {
            ...current,
            savedText: synced ? action.text : current.savedText,
            etag: action.etag,
            conflict: undefined,
            deletedOnDisk: undefined,
          },
        };
      }
      // Dirty buffer, different disk version: let the user decide.
      return {
        ...state,
        [action.path]: {
          ...current,
          deletedOnDisk: undefined,
          conflict: { diskText: action.text, diskEtag: action.etag },
        },
      };
    }
    case "edited": {
      const current = state[action.path];
      if (!current || current.text === action.text) return state;
      return { ...state, [action.path]: { ...current, text: action.text } };
    }
    case "saved": {
      const current = state[action.path];
      if (!current) return state;
      return {
        ...state,
        [action.path]: {
          ...current,
          savedText: action.text,
          etag: action.etag,
          conflict: undefined,
          deletedOnDisk: undefined,
        },
      };
    }
    case "resolved": {
      const current = state[action.path];
      if (!current?.conflict) return state;
      const { diskText, diskEtag } = current.conflict;
      const next: Buffer =
        action.keep === "disk"
          ? { path: current.path, text: diskText, savedText: diskText, etag: diskEtag }
          : // Keep my edits, now based on the disk version (so saving overwrites it deliberately).
            { path: current.path, text: current.text, savedText: diskText, etag: diskEtag };
      return { ...state, [action.path]: next };
    }
    case "deletedOnDisk": {
      const current = state[action.path];
      if (!current) return state;
      if (!isDirty(current)) {
        return without(state, action.path);
      }
      // Keep the edits around; saving re-creates the file.
      return { ...state, [action.path]: { ...current, etag: "", deletedOnDisk: true, conflict: undefined } };
    }
    case "renamed": {
      const current = state[action.from];
      if (!current) return state;
      return { ...without(state, action.from), [action.to]: { ...current, path: action.to } };
    }
    case "closed": {
      return without(state, action.path);
    }
    case "restored":
      return { ...action.buffers, ...state };
  }
}

// --- persistence: unsaved buffers survive a page reload (sessionStorage, per tab) -------------

const storageKey = (workspace: string) => `loomviz.buffers.${workspace}`;

interface Persisted {
  active: string | null;
  buffers: Pick<Buffer, "path" | "text" | "savedText" | "etag">[];
}

export function persistBuffers(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  workspace: string,
  buffers: Buffers,
  active: string | null,
): void {
  if (!storage) return;
  const dirty = Object.values(buffers).filter(isDirty);
  try {
    const data: Persisted = {
      active,
      buffers: dirty.map(({ path, text, savedText, etag }) => ({ path, text, savedText, etag })),
    };
    storage.setItem(storageKey(workspace), JSON.stringify(data));
  } catch {
    // Storage full or unavailable: unsaved edits just won't survive a reload.
  }
}

export function restoreBuffers(
  storage: Pick<Storage, "getItem"> | undefined,
  workspace: string,
): { buffers: Buffers; active: string | null } {
  try {
    const raw = storage?.getItem(storageKey(workspace));
    if (!raw) return { buffers: {}, active: null };
    const data = JSON.parse(raw) as Persisted;
    const buffers: Buffers = {};
    for (const b of data.buffers ?? []) {
      if (typeof b?.path === "string" && typeof b.text === "string" && typeof b.savedText === "string") {
        buffers[b.path] = { path: b.path, text: b.text, savedText: b.savedText, etag: String(b.etag ?? "") };
      }
    }
    return { buffers, active: typeof data.active === "string" ? data.active : null };
  } catch {
    return { buffers: {}, active: null };
  }
}

export function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
