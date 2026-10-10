import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { locateAt, locateComponent } from "../src/editor/locate";
const demo = readFileSync(resolve(process.cwd(), "../examples/loom/demo02.yml"), "utf8");
const broken: Record<string, string> = {
  "half-typed alias": demo.replace("<<: *molex_f # copying", "<<: *mole # copying"),
  "merge from a scalar": demo.replace("<<: *molex_f # copying", "<<: 5 # copying"),
  "unclosed flow list": demo.replace("pinlabels: [GND, +5V, SCL, SDA, MISO", "pinlabels: [GND, +5V"),
  "tab indentation": demo.replace("  X2:\n", "\tX2:\n"),
  "duplicate key": demo.replace("  X2:\n", "  X1:\n"),
  garbage: "connectors: {X1: [\n- - :\n",
};
// Regression: a half-typed alias made locateComponent throw during render, blanking the page.
it("never throws on broken YAML", () => {
  const out: string[] = [];
  for (const [name, text] of Object.entries(broken)) {
    for (const d of ["X1", "X2", "W1", "__F_1"]) {
      try {
        locateComponent(text, d);
      } catch (e) {
        out.push(`${name} / locateComponent(${d}): ${String(e).slice(0, 80)}`);
      }
    }
    try {
      locateAt(text, text.indexOf("X1") + 1);
    } catch (e) {
      out.push(`${name} / locateAt: ${String(e).slice(0, 80)}`);
    }
  }
  expect(out).toEqual([]);
});

it("still finds the component itself when only an alias is broken", () => {
  const x1 = locateComponent(broken["half-typed alias"], "X1");
  expect(x1.definition?.text).toBe("X1:");
  expect(x1.attributes).toBeNull(); // can't resolve the merge, so no attributes
  expect(x1.usages.length).toBe(3);
});
