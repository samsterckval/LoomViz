import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "../src/preview/sanitize";
import { elementsFor, selectionFromElement } from "../src/preview/selection";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const graphvizLike = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100pt" height="50pt" viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g id="graph0" class="graph">
<g id="node1" class="node"><title>X1</title><polygon points="0,0 10,0 10,10"/><text x="1" y="1">X1</text>
<image xlink:href="${PNG}" width="5" height="5"/></g>
<g id="wire&#45;W1&#45;3&#45;a" class="edge"><title>X1:e&#45;&#45;W1:w</title><path d="M0,0C1,1 2,2 3,3"/></g>
<g id="wire&#45;W1&#45;3&#45;b" class="edge"><title>W1:e&#45;&#45;X2:w</title><path d="M3,3C4,4 5,5 6,6"/></g>
</g></svg>`;

function mount(svg: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = sanitizeSvg(svg);
  return div;
}

describe("sanitizeSvg", () => {
  it("keeps what the diagram needs: shapes, text, titles, ids, classes, data: images", () => {
    const div = mount(graphvizLike);
    expect(div.querySelector("svg")).not.toBeNull();
    expect(div.querySelector("g.node > title")?.textContent).toBe("X1");
    expect(div.querySelector("#wire-W1-3-a")).not.toBeNull();
    expect(div.querySelector("image")?.getAttribute("xlink:href")).toBe(PNG);
  });

  it("removes everything that could run code or load from outside", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert(2)</script>
      <g onclick="alert(3)"><text>t</text></g>
      <a xlink:href="javascript:alert(4)"><text>link</text></a>
      <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
      <image xlink:href="https://evil.example/track.png"/>
      <image href="https://evil.example/track2.png"/>
      <style>@import url(https://evil.example/x.css);</style>
      <rect style="fill:url(https://evil.example/y)"/>
      <use xlink:href="https://evil.example/sprite.svg#a"/>
      <animate attributeName="href" to="javascript:alert(5)"/>
    </svg>`;
    const out = sanitizeSvg(evil);
    for (const bad of [
      "onload",
      "onclick",
      "<script",
      "javascript:",
      "foreignObject",
      "iframe",
      "evil.example",
      "<style",
      "<use",
      "<a",
    ]) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain("<text>t</text>");
  });
});

describe("selection", () => {
  it("maps clicks to components and wires, and finds both halves of a wire", () => {
    const div = mount(graphvizLike);
    expect(selectionFromElement(div.querySelector("g.node polygon"))).toEqual({
      kind: "component",
      designator: "X1",
    });
    const wire = selectionFromElement(div.querySelector("#wire-W1-3-b path"));
    expect(wire).toEqual({ kind: "wire", key: "W1-3" });
    expect(elementsFor(div, wire!).map((e) => e.id)).toEqual(["wire-W1-3-a", "wire-W1-3-b"]);
    expect(elementsFor(div, { kind: "component", designator: "X1" })).toHaveLength(1);
    expect(selectionFromElement(div.querySelector("svg"))).toBeNull();
  });
});
