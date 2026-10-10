import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locateAt, locateComponent } from "../src/editor/locate";

// Vitest runs from frontend/; the fixture is the shared example harness.
const demo = readFileSync(resolve(process.cwd(), "../examples/loom/demo02.yml"), "utf8");

describe("locateComponent on demo02.yml", () => {
  it("finds a connector, its merged attributes and its usage", () => {
    const x2 = locateComponent(demo, "X2");
    expect(x2.section).toBe("connectors");
    expect(x2.definition).toEqual({ line: 39, text: "X2:" });
    // Both << merges applied: Molex type from one template, I2C pin labels from the other.
    expect(x2.attributes).toMatchObject({ type: "Molex KK 254", pinlabels: ["GND", "+5V", "SCL", "SDA"] });
    expect(x2.usages.map((u) => u.text)).toEqual(["- X2: [1-4]"]);
  });

  it("finds a cable used in one connection set", () => {
    const w3 = locateComponent(demo, "W3");
    expect(w3.section).toBe("cables");
    expect(w3.attributes).toMatchObject({ colors: ["BK", "BU", "OG", "VT"], length: 0.3 });
    expect(w3.usages.map((u) => u.line)).toEqual([86]);
  });

  it("finds X1 in every connection set that uses it", () => {
    expect(locateComponent(demo, "X1").usages.map((u) => u.text)).toEqual([
      "- X1: [1-4]",
      "- X1: [1-4]",
      "- X1: [1,5-7]",
    ]);
  });

  it("maps generated ferrules back to the F. entry that creates them", () => {
    const f = locateComponent(demo, "__F_2");
    expect(f.generatedFrom).toBe("F.");
    expect(f.definition?.text).toBe("F:");
    expect(f.usages.map((u) => u.text)).toEqual(["- F."]);
  });

  it("copes with unknown designators and broken YAML", () => {
    expect(locateComponent(demo, "X99")).toMatchObject({ section: null, definition: null, usages: [] });
    expect(locateComponent("connectors: [", "X1").definition).toBeNull();
  });
});

describe("locateAt on demo02.yml (cursor → component)", () => {
  const offsetOf = (needle: string, nth = 0, delta = 1) => {
    let index = -1;
    for (let i = 0; i <= nth; i++) index = demo.indexOf(needle, index + 1);
    if (index < 0) throw new Error(`not found: ${needle}`);
    return index + delta;
  };

  it("finds a component from its definition key or any of its attributes", () => {
    expect(locateAt(demo, offsetOf("  X3:"))).toBe("X3");
    expect(locateAt(demo, offsetOf("pinlabels: [GND, +12V"))).toBe("X4");
    expect(locateAt(demo, offsetOf("colors: [BK, BU, OG, VT]", 0, 12))).toBe("W3");
  });

  it("finds a component from a connection-set entry, including its pin list", () => {
    expect(locateAt(demo, offsetOf("- W3: [1-4]", 0, 3))).toBe("W3");
    expect(locateAt(demo, offsetOf("- X4: [1,3-5]", 0, 9))).toBe("X4");
  });

  it("maps a template entry to the template", () => {
    expect(locateAt(demo, offsetOf("- F.", 0, 2))).toBe("F");
  });

  it("returns null elsewhere", () => {
    expect(locateAt(demo, offsetOf("title: WireViz Demo 2"))).toBeNull();
    expect(locateAt(demo, offsetOf("&molex_f"))).toBeNull(); // templates section
    expect(locateAt(demo, 0)).toBeNull();
    expect(locateAt("connectors: [", 5)).toBeNull();
  });
});

describe("locateAt at line starts", () => {
  it("matches with the cursor in the indentation or on the entry dash", () => {
    const lineStartOf = (needle: string) => demo.lastIndexOf("\n", demo.indexOf(needle)) + 1;
    expect(locateAt(demo, lineStartOf("  X3:"))).toBe("X3");
    expect(locateAt(demo, lineStartOf("    - W3: [1-4]"))).toBe("W3");
  });
});
