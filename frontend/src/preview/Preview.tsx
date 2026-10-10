import { useMemo } from "react";
import { withDocumentCsp } from "./document";
import type { PreviewState } from "./renderScheduler";

export type PreviewView = "diagram" | "document";

// The SVG is built from repository content, so it is shown as an <img> rather than injected
// into the page: scripts inside an <img> never run (PLAN D12).
export function Preview({
  state,
  view,
  onViewChange,
}: {
  state: PreviewState;
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
}) {
  // A data: URL needs no cleanup (unlike a blob: URL) and is just as inert inside <img>.
  const url = useMemo(
    () => (state.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}` : null),
    [state.svg],
  );
  const documentHtml = useMemo(() => (state.html ? withDocumentCsp(state.html) : null), [state.html]);

  return (
    <section className="preview" aria-label="Preview">
      <div className="tabs" role="tablist">
        {(["diagram", "document"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => onViewChange(v)}>
            {v === "diagram" ? "Diagram" : "Document"}
          </button>
        ))}
      </div>
      {state.error && (
        <div className="banner error" role="alert">
          {state.error.line !== null && <strong>Line {state.error.line}: </strong>}
          {state.error.message}
          {(view === "diagram" ? state.svg : state.html) && (
            <span className="hint"> (showing the last version that rendered)</span>
          )}
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
      {view === "diagram" ? (
        <div className={`canvas${state.error ? " stale" : ""}`}>
          {url ? <img src={url} alt="Harness diagram" /> : !state.error && <p>Rendering…</p>}
        </div>
      ) : (
        <div className={`document${state.error ? " stale" : ""}`}>
          {documentHtml ? (
            // sandbox="" : no scripts, no forms, no navigation, opaque origin (can't reach this page).
            <iframe sandbox="" srcDoc={documentHtml} title="WireViz document" />
          ) : (
            !state.error && <p>Rendering document…</p>
          )}
        </div>
      )}
    </section>
  );
}
