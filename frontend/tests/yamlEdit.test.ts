import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatScalar, readSection, removeSectionValue, setSectionValue } from "../src/editor/yamlEdit";

const demo = readFileSync(resolve(process.cwd(), "../examples/loom/demo02.yml"), "utf8");

/** Lines that differ between a and b (simple, order-preserving). */
function changed(a: string, b: string): { removed: string[]; added: string[] } {
  const A = a.split("\n");
  const B = b.split("\n");
  return { removed: A.filter((l) => !B.includes(l)), added: B.filter((l) => !A.includes(l)) };
}

describe("formatScalar (YAML 1.1, as PyYAML reads it)", () => {
  it("quotes what would otherwise change meaning", () => {
    expect(formatScalar("WH")).toBe("WH");
    expect(formatScalar("arial")).toBe("arial");
    expect(formatScalar("#ff8000")).toMatch(/^["']#ff8000["']$/); // '#' would start a comment
    expect(formatScalar("yes")).toMatch(/^["']yes["']$/); // YAML 1.1 boolean
    expect(formatScalar("on")).toMatch(/^["']on["']$/);
    expect(formatScalar("1.5")).toMatch(/^["']1\.5["']$/); // would be a number
    expect(formatScalar(true)).toBe("true");
  });
});

describe("setSectionValue", () => {
  it("creates the section after metadata, leaving everything else untouched", () => {
    const out = setSectionValue(demo, "options", "bgcolor", "YE");
    expect(out).toContain("    sheetsize: A3\n\noptions:\n  bgcolor: YE\n\ntemplates: # defining templates");
    expect(changed(demo, out)).toEqual({ removed: [], added: ["options:", "  bgcolor: YE"] });
    expect(readSection(out, "options")).toEqual({ bgcolor: "YE" });
  });

  it("creates the section at the top without metadata", () => {
    const text = "# comment\nconnectors:\n  X1: {pincount: 2}\n";
    expect(setSectionValue(text, "options", "fontname", "helvetica")).toBe(
      "# comment\noptions:\n  fontname: helvetica\n\nconnectors:\n  X1: {pincount: 2}\n",
    );
  });

  it("creates the section in an empty file", () => {
    expect(setSectionValue("", "options", "color_mode", "full")).toBe("options:\n  color_mode: full\n");
  });

  it("replaces a value in place, keeping its comment", () => {
    const text = "options:\n  bgcolor: WH # paper\n  fontname: arial\nconnectors: {}\n";
    expect(setSectionValue(text, "options", "bgcolor", "GY")).toBe(
      "options:\n  bgcolor: GY # paper\n  fontname: arial\nconnectors: {}\n",
    );
  });

  it("adds a key at the end of the block with its indentation", () => {
    const text = "options:\n    bgcolor: WH\n\nconnectors: {}\n";
    expect(setSectionValue(text, "options", "mini_bom_mode", false)).toBe(
      "options:\n    bgcolor: WH\n    mini_bom_mode: false\n\nconnectors: {}\n",
    );
  });

  it("fills a key that has no value yet", () => {
    expect(setSectionValue("options:\n  bgcolor:\n", "options", "bgcolor", "RD")).toBe(
      "options:\n  bgcolor: RD\n",
    );
  });

  it("fills an empty section", () => {
    expect(setSectionValue("options:\nconnectors: {}\n", "options", "bgcolor", "RD")).toBe(
      "options:\n  bgcolor: RD\nconnectors: {}\n",
    );
  });

  it("rewrites a flow-style section as a block", () => {
    expect(setSectionValue("options: {bgcolor: WH}\n", "options", "fontname", "x")).toBe(
      "options:\n  bgcolor: WH\n  fontname: x\n",
    );
  });

  it("quotes a hex colour", () => {
    const out = setSectionValue("options:\n  bgcolor: WH\n", "options", "bgcolor", "#ffcc00");
    expect(readSection(out, "options")).toEqual({ bgcolor: "#ffcc00" });
  });

  it("refuses YAML with errors", () => {
    expect(() => setSectionValue("options: [", "options", "bgcolor", "WH")).toThrow(/errors/);
    expect(readSection("options: [", "options")).toBeNull();
  });
});

describe("removeSectionValue", () => {
  it("removes only that key's line", () => {
    const text = "options:\n  bgcolor: WH # paper\n  fontname: arial\nconnectors: {}\n";
    expect(removeSectionValue(text, "options", "bgcolor")).toBe(
      "options:\n  fontname: arial\nconnectors: {}\n",
    );
  });

  it("removes the section when it becomes empty (and the blank line after it)", () => {
    const withOptions = setSectionValue(demo, "options", "bgcolor", "YE");
    expect(removeSectionValue(withOptions, "options", "bgcolor")).toBe(demo);
  });

  it("leaves the text alone when the key isn't there", () => {
    expect(removeSectionValue(demo, "options", "bgcolor")).toBe(demo);
  });

  it("works on a flow-style section", () => {
    expect(removeSectionValue("options: {bgcolor: WH, fontname: x}\n", "options", "bgcolor")).toBe(
      "options:\n  fontname: x\n",
    );
  });
});

describe("round trips on the demo", () => {
  it("setting all nine options and removing them again restores the file exactly", () => {
    const values: [string, string | boolean][] = [
      ["bgcolor", "WH"],
      ["bgcolor_node", "#eeeeee"],
      ["bgcolor_connector", "YE"],
      ["bgcolor_cable", "GN"],
      ["bgcolor_bundle", "GY"],
      ["color_mode", "full"],
      ["fontname", "helvetica"],
      ["mini_bom_mode", false],
      ["template_separator", "-"],
    ];
    let text = demo;
    for (const [k, v] of values) text = setSectionValue(text, "options", k, v);
    expect(readSection(text, "options")).toEqual(Object.fromEntries(values));
    for (const [k] of values) text = removeSectionValue(text, "options", k);
    expect(text).toBe(demo);
  });
});
