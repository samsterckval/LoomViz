// Targeted edits to a top-level mapping section of a WireViz YAML file (e.g. `options:`), as text
// splices: only the lines concerned change, so comments, key order and the formatting of the
// rest of the file stay byte-identical (PLAN D7, D22). Used by the options editor (FR-39) and
// meant for the later forms (FR-25 to FR-28).

import { isMap, isScalar, parseDocument, stringify, type Document, type Node, type Pair } from "yaml";

export type ScalarValue = string | number | boolean;

/** Parse like WireViz files need (repeated `<<` merge keys); null if the YAML has errors. */
function parse(text: string): Document | null {
  try {
    const doc = parseDocument(text, { merge: true });
    return doc.errors.length ? null : doc;
  } catch {
    return null;
  }
}

/** The values of a top-level section, or null if the YAML doesn't parse (forms go read-only). */
export function readSection(text: string, section: string): Record<string, unknown> | null {
  const doc = parse(text);
  if (!doc) return null;
  try {
    const value = doc.get(section);
    const js = isMap(value) ? value.toJS(doc) : value;
    return js && typeof js === "object" && !Array.isArray(js) ? (js as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * YAML text for a scalar, quoted where PyYAML (YAML 1.1, what WireViz uses) would read it as
 * something else: `yes`/`on` as booleans, `#…` as a comment, `1.0` as a number, and so on.
 */
export function formatScalar(value: ScalarValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return stringify(value, { version: "1.1" }).trim();
}

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const i = text.indexOf("\n", at);
  return i === -1 ? text.length : i;
};
/** End of the line containing `at`, including its newline. */
const lineEndWithBreak = (text: string, at: number) => Math.min(text.length, lineEnd(text, at) + 1);

const splice = (text: string, start: number, end: number, insert: string) =>
  text.slice(0, start) + insert + text.slice(end);

function topLevelPair(doc: Document, key: string): Pair<Node, Node | null> | undefined {
  const root = doc.contents;
  if (!isMap(root)) return undefined;
  return root.items.find((p) => isScalar(p.key) && String(p.key.value) === key) as
    Pair<Node, Node | null> | undefined;
}

function pairEnd(pair: Pair<Node, Node | null>): number {
  return pair.value?.range?.[1] ?? pair.key.range![1];
}

/** Rewrite a section as a block mapping (used when it was written in flow style, `{a: 1}`). */
function blockLines(values: Record<string, unknown>, indent: string): string {
  return Object.entries(values)
    .map(([k, v]) => `${indent}${k}: ${formatScalar(v as ScalarValue)}`)
    .join("\n");
}

/** Set `section.key` to `value`. Throws if the YAML doesn't parse. */
export function setSectionValue(text: string, section: string, key: string, value: ScalarValue): string {
  const doc = parse(text);
  if (!doc) throw new Error("The YAML has errors; fix them before using the form.");
  const formatted = formatScalar(value);
  const sectionPair = topLevelPair(doc, section);

  // No section yet: create it after `metadata:` if there is one, else before the first key.
  if (!sectionPair) {
    const block = `${section}:\n  ${key}: ${formatted}\n`;
    const root = doc.contents;
    if (!isMap(root) || root.items.length === 0) {
      const sep = text.length && !text.endsWith("\n") ? "\n" : "";
      return `${text}${sep}${block}`;
    }
    const pairs = root.items as Pair<Node, Node | null>[];
    const metadataIndex = pairs.findIndex((p) => isScalar(p.key) && p.key.value === "metadata");
    const next = pairs[metadataIndex + 1];
    if (metadataIndex >= 0 && !next) {
      const end = lineEndWithBreak(text, pairEnd(pairs[metadataIndex]));
      const sep = text.slice(0, end).endsWith("\n") ? "" : "\n";
      return splice(text, end, end, `${sep}\n${block}`);
    }
    const before = metadataIndex >= 0 ? next : pairs[0];
    const at = lineStart(text, before.key.range![0]);
    return splice(text, at, at, `${block}\n`);
  }

  const map = sectionPair.value;
  // `options:` with nothing after it.
  if (!map || (isScalar(map) && map.value === null)) {
    const at = lineEnd(text, sectionPair.key.range![1]);
    return splice(text, at, map?.range ? map.range[1] : at, `\n  ${key}: ${formatted}`);
  }
  if (!isMap(map)) throw new Error(`'${section}' is not a mapping.`);

  if (map.flow) {
    const values = { ...(map.toJS(doc) as Record<string, unknown>), [key]: value };
    const colon = text.indexOf(":", sectionPair.key.range![1]) + 1;
    return splice(text, colon, map.range![1], `\n${blockLines(values, "  ")}`);
  }

  const items = map.items as Pair<Node, Node | null>[];
  const existing = items.find((p) => isScalar(p.key) && String(p.key.value) === key);
  if (existing) {
    if (existing.value?.range && !(isScalar(existing.value) && existing.value.value === null)) {
      const [start, end] = existing.value.range;
      return splice(text, start, end, formatted);
    }
    const colon = text.indexOf(":", existing.key.range![1]) + 1; // `  key:` with no value
    return splice(text, colon, colon, ` ${formatted}`);
  }
  const first = items[0];
  const indent = first ? text.slice(lineStart(text, first.key.range![0]), first.key.range![0]) : "  ";
  const at = lineEnd(text, pairEnd(items[items.length - 1]));
  return splice(text, at, at, `\n${indent}${key}: ${formatted}`);
}

/** Remove `section.key` (and the section, if it becomes empty). Throws if the YAML doesn't parse. */
export function removeSectionValue(text: string, section: string, key: string): string {
  const doc = parse(text);
  if (!doc) throw new Error("The YAML has errors; fix them before using the form.");
  const sectionPair = topLevelPair(doc, section);
  const map = sectionPair?.value;
  if (!sectionPair || !isMap(map)) return text;
  const items = map.items as Pair<Node, Node | null>[];
  const existing = items.find((p) => isScalar(p.key) && String(p.key.value) === key);
  if (!existing) return text;

  const removeSection = () => {
    const start = lineStart(text, sectionPair.key.range![0]);
    let end = lineEndWithBreak(text, pairEnd(sectionPair));
    if (text.slice(end).startsWith("\n")) end += 1; // and the blank line after it
    return splice(text, start, end, "");
  };
  if (items.length === 1) return removeSection();
  if (map.flow) {
    const values = { ...(map.toJS(doc) as Record<string, unknown>) };
    delete values[key];
    const colon = text.indexOf(":", sectionPair.key.range![1]) + 1;
    return splice(text, colon, map.range![1], `\n${blockLines(values, "  ")}`);
  }
  const start = lineStart(text, existing.key.range![0]);
  const end = lineEndWithBreak(text, pairEnd(existing));
  return splice(text, start, end, "");
}
