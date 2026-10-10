// M0.6 spike: can the `yaml` npm package edit real WireViz files without reformatting them?
//
// Usage:
//   pnpm start                 # report
//   pnpm start -- --write DIR  # also write each edited file to DIR (for render checks in Python)
//
// Three strategies on examples/loom/demo02.yml:
//   A. Document API + toString(): re-serialises the whole document.
//   B. CST: lossless concrete syntax tree, edit one scalar token, stringify.
//   C. Splice: parse with the Document API, use node.range offsets to replace or insert
//      text in the original source; everything else stays byte-identical.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CST, isMap, isScalar, Parser, parseDocument, type Document } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, "..", "..", "examples", "loom", "demo02.yml");

export const PARSE_OPTIONS = { merge: true } as const; // WireViz files use YAML 1.1 merge keys
export const BEST_TOSTRING = { lineWidth: 0, flowCollectionPadding: false, indentSeq: true } as const;

export function parse(src: string): Document {
  const doc = parseDocument(src, PARSE_OPTIONS);
  if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join("\n"));
  return doc;
}

/** Lines that differ between a and b, as "-old" / "+new" (LCS diff). */
export function changedLines(a: string, b: string): string[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      i++;
      j++;
    } else if (j < B.length && (i === A.length || L[i][j + 1] >= L[i + 1][j])) out.push("+" + B[j++]);
    else out.push("-" + A[i++]);
  }
  return out;
}

// A. Whole-document re-serialisation
export function documentEdit(src: string, path: string[], value: unknown): string {
  const doc = parse(src);
  doc.setIn(path, value);
  return doc.toString(BEST_TOSTRING);
}

// B. CST: find the scalar for `path` and replace its source in place
export function cstEdit(src: string, path: string[], value: string): string {
  const tokens = [...new Parser().parse(src)];
  const doc = tokens.find((t) => t.type === "document");
  if (!doc || doc.type !== "document") throw new Error("no document");
  let node: CST.Token | undefined = doc.value;
  for (const key of path) {
    if (!node || node.type !== "block-map") throw new Error(`not a block map at ${key}`);
    const item: CST.BlockMap["items"][number] | undefined = node.items.find(
      (it) => it.key && CST.isScalar(it.key) && it.key.source === key,
    );
    if (!item) throw new Error(`key ${key} not found`);
    node = item.value;
  }
  if (!node || !CST.isScalar(node)) throw new Error("target is not a scalar");
  CST.setScalarValue(node, value);
  return tokens.map((t) => CST.stringify(t)).join("");
}

// C. Splice: replace the exact source range of the target scalar
export function spliceSetScalar(src: string, path: string[], valueSource: string): string {
  const node = parse(src).getIn(path, true);
  if (!isScalar(node) || !node.range) throw new Error("target is not a scalar with a range");
  const [start, valueEnd] = node.range;
  return src.slice(0, start) + valueSource + src.slice(valueEnd);
}

// C. Splice: append a new entry at the end of a block mapping, matching its indentation
export function spliceAddEntry(src: string, mapPath: string[], key: string, bodyLines: string[]): string {
  const map = parse(src).getIn(mapPath, true);
  if (!isMap(map) || !map.range || map.flow) throw new Error("target is not a block mapping");
  const firstKey = map.items[0]?.key;
  if (!isScalar(firstKey) || !firstKey.range) throw new Error("empty mapping not handled in spike");
  const lineStart = src.lastIndexOf("\n", firstKey.range[0] - 1) + 1;
  const indent = src.slice(lineStart, firstKey.range[0]);
  // Insert after the mapping's last content line (range[1] = end of its value).
  const valueEnd = map.range[1];
  const insertAt = src.indexOf("\n", valueEnd - 1) + 1 || src.length;
  const childIndent = indent + "  ";
  const text = `${indent}${key}:\n` + bodyLines.map((l) => `${childIndent}${l}\n`).join("");
  return src.slice(0, insertAt) + text + src.slice(insertAt);
}

export function edits(src: string): Record<string, string> {
  const w1 = ["cables", "W1", "length"];
  return {
    "A-document-unchanged": parse(src).toString(BEST_TOSTRING),
    "A-document-edit": documentEdit(src, w1, 0.25),
    "B-cst-unchanged": [...new Parser().parse(src)].map((t) => CST.stringify(t)).join(""),
    "B-cst-edit": cstEdit(src, w1, "0.25"),
    "C-splice-edit": spliceSetScalar(src, w1, "0.25"),
    "C-splice-add-connector": spliceAddEntry(src, ["connectors"], "X5", [
      "<<: *molex_f",
      "pinlabels: [GND, +5V]",
    ]),
  };
}

function main(): void {
  const src = readFileSync(FIXTURE, "utf8");
  const writeIdx = process.argv.indexOf("--write");
  const outDir = writeIdx >= 0 ? process.argv[writeIdx + 1] : undefined;
  if (outDir) mkdirSync(outDir, { recursive: true });

  console.log(`yaml ${process.env.npm_package_dependencies_yaml ?? "2.9.1"}, node ${process.version}`);
  console.log(`parse with ${JSON.stringify(PARSE_OPTIONS)}: errors = ${parseDocument(src, PARSE_OPTIONS).errors.length}`);
  console.log(`parse with default options: errors = ${parseDocument(src).errors.length}\n`);

  for (const [name, out] of Object.entries(edits(src))) {
    const diff = changedLines(src, out);
    console.log(`${name.padEnd(24)} changed lines vs original: ${diff.length}`);
    if (diff.length && diff.length <= 4) for (const line of diff) console.log(`    ${line}`);
    if (outDir) writeFileSync(join(outDir, `${name}.yml`), out);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
