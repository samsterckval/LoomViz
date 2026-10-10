import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fit, isDrag, wheelFactor, zoomAt, type View } from "./panzoomMath";

// Zoom (wheel, pinch, buttons), pan (drag) and fit for the diagram (SPEC FR-15).
// - fitKey: when it changes (another file opened), the view fits once the content is there;
//   re-renders of the same file keep the current view.
// - A drag doesn't count as a click, so panning never changes the selection.
export function PanZoom({
  fitKey,
  contentKey,
  children,
}: {
  fitKey: string;
  contentKey: string | null;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pendingFit = useRef(true);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const fitNow = useCallback(() => {
    const vp = viewport.current;
    const c = content.current;
    if (!vp || !c) return;
    setView(fit(c.offsetWidth, c.offsetHeight, vp.clientWidth, vp.clientHeight));
  }, []);

  useEffect(() => {
    pendingFit.current = true;
  }, [fitKey]);

  // Fit after the first content of a new file has been laid out.
  useLayoutEffect(() => {
    if (pendingFit.current && contentKey) {
      pendingFit.current = false;
      fitNow();
    }
  }, [contentKey, fitKey, fitNow]);

  // Wheel needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor = wheelFactor(event.deltaY, event.deltaMode);
      setView((v) => zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const zoomButton = (factor: number) => {
    const vp = viewport.current;
    if (!vp) return;
    setView((v) => zoomAt(v, factor, vp.clientWidth / 2, vp.clientHeight / 2));
  };

  return (
    <div
      ref={viewport}
      className="panzoom"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { startX: e.clientX, startY: e.clientY, x: view.x, y: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && !isDrag(dx, dy)) return;
        if (!d.moved) {
          d.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
      }}
      onPointerUp={() => {
        suppressClick.current = !!drag.current?.moved;
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation(); // the press was a drag: don't select anything
          suppressClick.current = false;
        }
      }}
    >
      <div
        ref={content}
        className="panzoom-content"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      <div className="panzoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomButton(1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomButton(0.8)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button onClick={fitNow} title="Fit to view" aria-label="Fit to view">
          Fit
        </button>
        <span className="zoom-level">{Math.round(view.scale * 100)}%</span>
      </div>
    </div>
  );
}
