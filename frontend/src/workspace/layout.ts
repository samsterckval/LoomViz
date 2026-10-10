// Pane widths for the resizable layout (PLAN M2.9). Kept in localStorage as a per-viewer
// convenience; everything works without it.

export interface Layout {
  tree: number; // px
  editor: number; // px
}

export const DEFAULT_LAYOUT: Layout = { tree: 220, editor: 520 };
const MIN_TREE = 140;
const MAX_TREE = 480;
const MIN_EDITOR = 260;
const MIN_PREVIEW = 300;
const KEY = "loomviz.layout";

/** Keep both panes within bounds for a window of `total` px (the preview gets the rest). */
export function clampLayout(layout: Layout, total: number): Layout {
  const tree = Math.round(Math.min(MAX_TREE, Math.max(MIN_TREE, layout.tree)));
  const maxEditor = Math.max(MIN_EDITOR, total - tree - MIN_PREVIEW);
  const editor = Math.round(Math.min(maxEditor, Math.max(MIN_EDITOR, layout.editor)));
  return { tree, editor };
}

export function loadLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Layout>) : {};
    return {
      tree: typeof parsed.tree === "number" ? parsed.tree : DEFAULT_LAYOUT.tree,
      editor: typeof parsed.editor === "number" ? parsed.editor : DEFAULT_LAYOUT.editor,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // not available: sizes just aren't remembered
  }
}
