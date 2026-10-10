// Map a click inside the diagram to what was clicked, using what the SVG carries:
// - connectors and cables: Graphviz <g class="node"> with the designator as <title>;
// - wires: <g class="edge" id="wire-<cable>-<n>-a|b"> (ids added by the back-end, FR-31).

export type Selection = { kind: "component"; designator: string } | { kind: "wire"; key: string };

const WIRE_ID = /^wire-(.+)-([^-]+)-[ab]$/;

export function selectionFromElement(target: Element | null): Selection | null {
  const group = target?.closest("g.node, g.edge");
  if (!group) return null;
  if (group.classList.contains("node")) {
    const title = group.querySelector(":scope > title")?.textContent?.trim();
    return title ? { kind: "component", designator: title } : null;
  }
  const match = WIRE_ID.exec(group.id);
  return match ? { kind: "wire", key: `${match[1]}-${match[2]}` } : null;
}

/** Elements to highlight for a selection. */
export function elementsFor(root: ParentNode, selection: Selection): Element[] {
  if (selection.kind === "wire") {
    const prefix = `wire-${selection.key}-`.replace(/["\\]/g, "\\$&");
    return [...root.querySelectorAll(`g.edge[id^="${prefix}"]`)];
  }
  // The component's node, nodes WireViz generated from it as a template (`__F_1` for `F`), and,
  // for a cable, its wires.
  const name = selection.designator;
  const nodes = [...root.querySelectorAll("g.node")].filter((g) => {
    const title = g.querySelector(":scope > title")?.textContent?.trim() ?? "";
    return title === name || (title.startsWith(`__${name}_`) && /^\d+$/.test(title.slice(name.length + 3)));
  });
  const prefix = `wire-${name}-`.replace(/["\\]/g, "\\$&");
  return [...nodes, ...root.querySelectorAll(`g.edge[id^="${prefix}"]`)];
}
