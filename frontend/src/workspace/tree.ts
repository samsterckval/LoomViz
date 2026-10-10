// Build the file tree (SPEC FR-7) from the flat, loom-relative file list the API returns.

export interface TreeNode {
  name: string;
  path: string; // loom-relative; for folders, without a trailing slash
  children?: TreeNode[]; // present for folders
}

export function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let child = node.children!.find((c) => c.name === part && !!c.children === !isFile);
      if (!child) {
        child = isFile ? { name: part, path } : { name: part, path, children: [] };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children!);
}

/** Normalise a user-typed new file name: trim, drop leading slashes, add .yml if no YAML suffix. */
export function normaliseNewPath(input: string): string | null {
  const path = input.trim().replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!path || path.endsWith("/")) return null;
  return /\.ya?ml$/i.test(path) ? path : `${path}.yml`;
}
