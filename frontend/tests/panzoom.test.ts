import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, fit, isDrag, wheelFactor, zoomAt } from "../src/preview/panzoomMath";

describe("zoomAt", () => {
  it("keeps the point under the pointer fixed", () => {
    const view = { scale: 1, x: 10, y: 20 };
    const next = zoomAt(view, 2, 110, 120);
    // The content point under the pointer was (100, 100); it must still map to (110, 120).
    expect(next).toEqual({ scale: 2, x: -90, y: -80 });
    expect(100 * next.scale + next.x).toBe(110);
    expect(100 * next.scale + next.y).toBe(120);
  });

  it("clamps the scale", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 1000, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.0001, 0, 0).scale).toBe(MIN_SCALE);
  });
});

describe("fit", () => {
  it("scales a large diagram down and centres it", () => {
    const view = fit(1000, 500, 532, 432, 16);
    expect(view.scale).toBe(0.5);
    expect(view).toEqual({ scale: 0.5, x: 16, y: 91 });
  });

  it("doesn't blow small diagrams up past 1.5x", () => {
    expect(fit(100, 100, 1000, 1000).scale).toBe(1.5);
  });

  it("handles an empty viewport or content", () => {
    expect(fit(0, 0, 500, 500)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("wheel and drag", () => {
  it("zooms in on wheel up, out on wheel down, symmetrically", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(-100, 0) * wheelFactor(100, 0)).toBeCloseTo(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0)); // lines → pixels
  });

  it("tells drags from clicks", () => {
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(5, 0)).toBe(true);
  });
});
