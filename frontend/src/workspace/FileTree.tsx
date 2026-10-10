import { useState, type FormEvent } from "react";
import { buildTree, normaliseNewPath, type TreeNode } from "./tree";

// The loom/ file tree (SPEC FR-7): open, create, rename, delete; unsaved files marked ●.
export function FileTree({
  files,
  active,
  dirty,
  deletedOnDisk,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  files: string[];
  active: string | null;
  dirty: Set<string>;
  deletedOnDisk: Set<string>;
  onOpen: (path: string) => void;
  onCreate: (path: string) => Promise<string | null>; // resolves to an error message, or null
  onRename: (from: string, to: string) => Promise<string | null>;
  onDelete: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tree = buildTree([...new Set([...files, ...deletedOnDisk])].sort());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const submitNew = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = normaliseNewPath(String(new FormData(event.currentTarget).get("name") ?? ""));
    if (!path) return setError("Enter a file name, e.g. harness or sub/harness.yml");
    const problem = await onCreate(path);
    setError(problem);
    if (!problem) setCreating(false);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>, from: string) => {
    event.preventDefault();
    const to = normaliseNewPath(String(new FormData(event.currentTarget).get("name") ?? ""));
    if (!to) return setError("Enter a file name");
    if (to === from) return setRenaming(null);
    const problem = await onRename(from, to);
    setError(problem);
    if (!problem) setRenaming(null);
  };

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 14 };
      if (node.children) {
        const isCollapsed = collapsed.has(node.path);
        return (
          <li key={`d:${node.path}`}>
            <button className="tree-row folder" style={indent} onClick={() => toggle(node.path)}>
              <span className="twisty">{isCollapsed ? "▸" : "▾"}</span> {node.name}/
            </button>
            {!isCollapsed && <ul>{render(node.children, depth + 1)}</ul>}
          </li>
        );
      }
      if (renaming === node.path) {
        return (
          <li key={node.path}>
            <form className="tree-input" style={indent} onSubmit={(e) => void submitRename(e, node.path)}>
              <input
                name="name"
                defaultValue={node.path}
                autoFocus
                aria-label={`New name for ${node.path}`}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                onBlur={() => setRenaming(null)}
              />
            </form>
          </li>
        );
      }
      const classes = [
        "tree-row",
        "file",
        node.path === active && "active",
        deletedOnDisk.has(node.path) && "gone",
      ];
      return (
        <li key={node.path} className="tree-file">
          <button
            className={classes.filter(Boolean).join(" ")}
            style={indent}
            onClick={() => onOpen(node.path)}
            onDoubleClick={() => setRenaming(node.path)}
            title={deletedOnDisk.has(node.path) ? "Deleted on disk; saving re-creates it" : node.path}
          >
            {node.name}
            {dirty.has(node.path) && (
              <span className="dot" aria-label="unsaved">
                {" "}
                ●
              </span>
            )}
          </button>
          <span className="tree-actions">
            <button title="Rename" aria-label={`Rename ${node.path}`} onClick={() => setRenaming(node.path)}>
              ✎
            </button>
            <button title="Delete" aria-label={`Delete ${node.path}`} onClick={() => onDelete(node.path)}>
              🗑
            </button>
          </span>
        </li>
      );
    });

  return (
    <nav className="file-tree" aria-label="Harness files">
      <div className="tree-header">
        <span className="muted">loom/</span>
        <button onClick={() => (setCreating(true), setError(null))} title="New harness file">
          + New
        </button>
      </div>
      {creating && (
        <form className="tree-input" onSubmit={(e) => void submitNew(e)}>
          <input
            name="name"
            placeholder="name or sub/name.yml"
            autoFocus
            aria-label="New file name"
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
          />
        </form>
      )}
      {error && <p className="tree-error">{error}</p>}
      <ul>{render(tree, 0)}</ul>
      {files.length === 0 && !creating && <p className="muted tree-empty">No harness files yet.</p>}
    </nav>
  );
}
