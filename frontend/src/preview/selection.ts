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
  return [...root.querySelectorAll("g.node")].filter(
    (g) => g.querySelector(":scope > title")?.textContent?.trim() === selection.designator,
  );
}
