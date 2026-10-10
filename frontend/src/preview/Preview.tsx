import { useMemo } from "react";
import type { PreviewState } from "./renderScheduler";

// The SVG is built from repository content, so it is shown as an <img> rather than injected
// into the page: scripts inside an <img> never run (PLAN D12).
export function Preview({ state }: { state: PreviewState }) {
  // A data: URL needs no cleanup (unlike a blob: URL) and is just as inert inside <img>.
  const url = useMemo(
    () => (state.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}` : null),
    [state.svg],
  );

  return (
    <section className="preview" aria-label="Diagram preview">
      {state.error && (
        <div className="banner error" role="alert">
          {state.error.line !== null && <strong>Line {state.error.line}: </strong>}
          {state.error.message}
          {state.svg && <span className="hint"> (showing the last diagram that rendered)</span>}
        </div>
      )}
      {state.warnings.length > 0 && !state.error && (
        <div className="banner warning">
          {state.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {state.rendering && <div className="rendering">rendering…</div>}
      <div className={`canvas${state.error ? " stale" : ""}`}>
        {url ? <img src={url} alt="Harness diagram" /> : !state.error && <p>Rendering…</p>}
      </div>
    </section>
  );
}
