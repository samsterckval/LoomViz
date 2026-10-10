import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locateComponent } from "../src/editor/locate";

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
