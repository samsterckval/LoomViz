import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import {
  FIXTURE,
  PARSE_OPTIONS,
  changedLines,
  cstEdit,
  documentEdit,
  edits,
  parse,
  spliceAddEntry,
  spliceSetScalar,
} from "./roundtrip.ts";

const src = readFileSync(FIXTURE, "utf8");
const W1_LENGTH = ["cables", "W1", "length"];

test("repeated << merge keys fail with default options", () => {
  assert.equal(parseDocument(src).errors.length, 2);
});

test("repeated << merge keys parse with merge: true", () => {
  assert.equal(parseDocument(src, PARSE_OPTIONS).errors.length, 0);
  // Both merges apply: X2 gets the Molex type and the I2C pin labels.
  const x2 = parse(src).toJS().connectors.X2;
  assert.equal(x2.type, "Molex KK 254");
  assert.deepEqual(x2.pinlabels, ["GND", "+5V", "SCL", "SDA"]);
});

test("A: whole-document toString reformats the file", () => {
  assert.notEqual(parse(src).toString(), src);
  assert.ok(changedLines(src, documentEdit(src, W1_LENGTH, 0.25)).length > 2);
});

test("B: CST round trip is byte-identical", () => {
  assert.equal(edits(src)["B-cst-unchanged"], src);
});

test("B: CST scalar edit changes exactly one line", () => {
  assert.deepEqual(changedLines(src, cstEdit(src, W1_LENGTH, "0.25")), ["+    length: 0.25", "-    length: 0.2"]);
});

test("C: splice scalar edit changes exactly one line", () => {
  assert.deepEqual(changedLines(src, spliceSetScalar(src, W1_LENGTH, "0.25")), [
    "+    length: 0.25",
    "-    length: 0.2",
  ]);
});

test("C: splice adds a connector with only the new lines", () => {
  const out = spliceAddEntry(src, ["connectors"], "X5", ["<<: *molex_f", "pinlabels: [GND, +5V]"]);
  assert.deepEqual(changedLines(src, out), ["+  X5:", "+    <<: *molex_f", "+    pinlabels: [GND, +5V]"]);
  const x5 = parse(out).toJS().connectors.X5;
  assert.equal(x5.type, "Molex KK 254");
});

test("comments survive every lossless edit", () => {
  const comments = (s: string) => s.match(/#[^\n]*/g) ?? [];
  for (const name of ["B-cst-edit", "C-splice-edit", "C-splice-add-connector"]) {
    assert.deepEqual(comments(edits(src)[name]), comments(src), name);
  }
});
