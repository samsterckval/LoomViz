import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { withDocumentCsp } from "./document";
import { PanZoom } from "./PanZoom";
import type { PreviewState } from "./renderScheduler";
import { sanitizeSvg } from "./sanitize";
import { elementsFor, selectionFromElement, type Selection } from "./selection";

export type PreviewView = "diagram" | "document";

// The diagram is inserted into the page so it can be clicked, but only after sanitising
// (PLAN D15): it is built from repository content.
export function Preview({
  state,
  view,
  onViewChange,
  selection,
  onSelect,
  panel,
  fitKey,
  outOfDate,
  onRender,
  autoRender,
  onAutoRenderChange,
}: {
  state: PreviewState;
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  panel?: ReactNode;
  /** Changes when another file is opened: the diagram fits to view again. */
  fitKey: string;
  /** The editor text changed since the last render (FR-11). */
  outOfDate: boolean;
  onRender: () => void;
  autoRender: boolean;
  onAutoRenderChange: (on: boolean) => void;
}) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↩" : "Ctrl+Enter";
  const diagram = useRef<HTMLDivElement>(null);
  const safeSvg = useMemo(() => (state.svg ? sanitizeSvg(state.svg) : null), [state.svg]);

  // Highlight the selected element(s); re-applied whenever the diagram is re-rendered.
  useEffect(() => {
    const root = diagram.current;
    if (!root) return;
    root.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
    if (selection) elementsFor(root, selection).forEach((el) => el.classList.add("selected"));
  }, [safeSvg, selection, view]);
  const documentHtml = useMemo(() => (state.html ? withDocumentCsp(state.html) : null), [state.html]);

  return (
    <section className="preview" aria-label="Preview">
      <div className="tabs" role="tablist">
        {(["diagram", "document"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => onViewChange(v)}>
            {v === "diagram" ? "Diagram" : "Document"}
          </button>
        ))}
        <span className="render-controls">
          {outOfDate && !state.rendering && <span className="out-of-date">out of date</span>}
          <button
            className={outOfDate ? "primary" : undefined}
            onClick={onRender}
            disabled={state.rendering}
            title={`Render the editor content (${shortcut})`}
          >
            {state.rendering ? "Rendering…" : "Render"} <kbd>{shortcut}</kbd>
          </button>
          <label title="Render automatically after each edit">
            <input
              type="checkbox"
              checked={autoRender}
              onChange={(e) => onAutoRenderChange(e.target.checked)}
            />{" "}
            Auto
          </label>
        </span>
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
      {view === "diagram" ? (
        <>
          <div className={`canvas${state.error ? " stale" : ""}`}>
            {safeSvg ? (
              <PanZoom fitKey={fitKey} contentKey={safeSvg}>
                <div
                  ref={diagram}
                  className="diagram"
                  role="img"
                  aria-label="Harness diagram; click a connector, cable or wire to find it in the YAML"
                  onClick={(e) => onSelect(selectionFromElement(e.target as Element))}
                  dangerouslySetInnerHTML={{ __html: safeSvg }}
                />
              </PanZoom>
            ) : (
              !state.error && <p>Rendering…</p>
            )}
          </div>
          {panel}
        </>
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
