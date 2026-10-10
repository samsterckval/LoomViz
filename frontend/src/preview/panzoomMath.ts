// Zoom and pan maths for the diagram (SPEC FR-15). The content is drawn with
// `transform: translate(x, y) scale(scale)` from its top-left corner.

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
/** A pointer that moved more than this (px) between press and release dragged, not clicked. */
export const DRAG_THRESHOLD = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Zoom by `factor`, keeping the content point under (px, py) (viewport coordinates) in place. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** Scale and centre content of (width × height) inside a (viewWidth × viewHeight) viewport. */
export function fit(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
  padding = 16,
): View {
  if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clamp(
    Math.min((viewWidth - 2 * padding) / width, (viewHeight - 2 * padding) / height, 1.5),
    MIN_SCALE,
    MAX_SCALE,
  );
  return { scale, x: (viewWidth - width * scale) / 2, y: (viewHeight - height * scale) / 2 };
}

/** Wheel delta → zoom factor (smooth for trackpads, a fixed step per mouse-wheel notch). */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(pixels, -100, 100) / 300);
}

export const isDrag = (dx: number, dy: number) => Math.hypot(dx, dy) > DRAG_THRESHOLD;
