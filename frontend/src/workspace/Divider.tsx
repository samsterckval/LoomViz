import { useRef } from "react";

// A vertical drag handle between two panes. Reports the horizontal distance dragged since the
// press (so the parent can apply it to the width it had at that moment). Arrow keys move it too.
export function Divider({
  label,
  onDragStart,
  onDrag,
  onDragEnd,
  onStep,
}: {
  label: string;
  onDragStart: () => void;
  onDrag: (dx: number) => void;
  onDragEnd: () => void;
  onStep: (dx: number) => void;
}) {
  const start = useRef<number | null>(null);
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        onDragStart();
      }}
      onPointerMove={(e) => {
        if (start.current !== null) onDrag(e.clientX - start.current);
      }}
      onPointerUp={() => {
        if (start.current !== null) onDragEnd();
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onStep(-16);
        if (e.key === "ArrowRight") onStep(16);
      }}
    />
  );
}
