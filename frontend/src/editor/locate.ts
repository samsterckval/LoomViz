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
