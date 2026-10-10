// Find where a connector or cable lives in the YAML (SPEC FR-31): its definition, the
// connection-set entries that use it, and its resolved attributes (templates and `<<` merges
// applied). Parsed with the `yaml` package and { merge: true }, as WireViz files need (PLAN D7).

import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Node } from "yaml";

export interface Location {
  line: number; // 1-based
  text: string; // the source line, trimmed
}

export interface ComponentLocation {
  designator: string;
  section: "connectors" | "cables" | null;
  definition: Location | null;
  attributes: Record<string, unknown> | null;
  usages: Location[];
  /** For components WireViz generates itself (`__F_1` from `F.`): the template it came from. */
  generatedFrom: string | null;
}

const GENERATED = /^__(.+)_\d+$/;

export function locateComponent(yamlText: string, designator: string): ComponentLocation {
  const lineCounter = new LineCounter();
  const doc = parseDocument(yamlText, { merge: true, lineCounter });
  const lines = yamlText.split("\n");
  const at = (offset: number): Location => {
    const line = lineCounter.linePos(offset).line;
    return { line, text: (lines[line - 1] ?? "").trim() };
  };

  const generated = GENERATED.exec(designator);
  const name = generated ? generated[1] : designator;
  const result: ComponentLocation = {
    designator,
    section: null,
    definition: null,
    attributes: null,
    usages: [],
    generatedFrom: generated ? `${name}.` : null,
  };

  for (const section of ["connectors", "cables"] as const) {
    const map = doc.get(section, true);
    if (!isMap(map)) continue;
    for (const pair of map.items) {
      if (isScalar(pair.key) && String(pair.key.value) === name && pair.key.range) {
        result.section = section;
        result.definition = at(pair.key.range[0]);
        const value = pair.value as Node | null;
        const js = value ? value.toJS(doc) : null;
        result.attributes = js && typeof js === "object" ? (js as Record<string, unknown>) : null;
      }
    }
  }

  // Usages in connection sets: `- X1: [1-4]` (map entry), `- X1` or `- F.` (scalar entry).
  const connections = doc.get("connections", true);
  if (isSeq(connections)) {
    for (const set of connections.items) {
      if (!isSeq(set)) continue;
      for (const entry of set.items) {
        if (isMap(entry)) {
          for (const pair of entry.items) {
            if (isScalar(pair.key) && matches(pair.key.value, name) && pair.key.range)
              result.usages.push(at(pair.key.range[0]));
          }
        } else if (isScalar(entry) && matches(entry.value, name) && entry.range) {
          result.usages.push(at(entry.range[0]));
        }
      }
    }
  }
  return result;
}

function matches(value: unknown, name: string): boolean {
  const text = String(value);
  return text === name || text === `${name}.`;
}

/**
 * The reverse (SPEC FR-32): which connector or cable is the cursor on? Returns its designator
 * (for a template entry like `F.`, the template name `F`), or null.
 *
 * Matches the cursor inside a component's definition (key or any of its attributes) or inside
 * a connection-set entry (`- X1: [1-4]`, `- F.`).
 */
export function locateAt(yamlText: string, offset: number): string | null {
  const doc = parseDocument(yamlText, { merge: true });
  // A node's range starts at its first character; count the line's indentation (and an entry's
  // "- ") as part of it, so a cursor at the start of the line still matches.
  const lineStart = (at: number) => yamlText.lastIndexOf("\n", at - 1) + 1;
  const inside = (start: number | undefined, end: number | undefined) =>
    start !== undefined && end !== undefined && offset >= lineStart(start) && offset <= end;

  // Ranges of neighbouring items touch (one ends where the next line starts), so the last
  // match wins: at a boundary, the cursor is at the start of the later item.
  let found: string | null = null;
  for (const section of ["connectors", "cables"] as const) {
    const map = doc.get(section, true);
    if (!isMap(map)) continue;
    for (const pair of map.items) {
      if (!isScalar(pair.key) || !pair.key.range) continue;
      const value = pair.value as Node | null;
      const end = value?.range ? value.range[1] : pair.key.range[1];
      if (inside(pair.key.range[0], end)) found = String(pair.key.value);
    }
  }
  if (found) return found;

  const connections = doc.get("connections", true);
  if (isSeq(connections)) {
    for (const set of connections.items) {
      if (!isSeq(set)) continue;
      for (const entry of set.items) {
        if (isMap(entry)) {
          for (const pair of entry.items) {
            if (!isScalar(pair.key) || !pair.key.range) continue;
            const value = pair.value as Node | null;
            const end = value?.range ? value.range[1] : pair.key.range[1];
            if (inside(pair.key.range[0], end)) found = stripTemplateDot(String(pair.key.value));
          }
        } else if (isScalar(entry) && entry.range && inside(entry.range[0], entry.range[1])) {
          found = stripTemplateDot(String(entry.value));
        }
      }
    }
  }
  return found;
}

function stripTemplateDot(name: string): string {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}
