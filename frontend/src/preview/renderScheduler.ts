// Debounced live rendering (SPEC FR-11 to FR-13):
// - waits `delayMs` after the last edit before rendering;
// - aborts the previous request when a new one starts, and ignores any response that isn't
//   for the latest request (request ids), so a slow old render can never overwrite a newer one;
// - keeps the last good SVG when a render fails.

import type { RenderResult, WireInfo } from "../api/client";

export interface PreviewState {
  svg: string | null; // last good diagram
  html: string | null; // last good WireViz document, when it was requested
  wires: Record<string, WireInfo>; // wires of the last good diagram
  /** The text of the latest render request: compare with the editor to know if the diagram is out of date. */
  source: string | null;
  warnings: string[];
  error: { message: string; line: number | null } | null;
  rendering: boolean;
}

export const initialPreview: PreviewState = {
  svg: null,
  html: null,
  wires: {},
  source: null,
  warnings: [],
  error: null,
  rendering: false,
};

type RenderFn = (
  yaml: string,
  path: string | null,
  signal: AbortSignal,
  html: boolean,
) => Promise<RenderResult>;

export function createRenderScheduler(options: {
  render: RenderFn;
  onUpdate: (state: PreviewState) => void;
  delayMs?: number;
}) {
  const delayMs = options.delayMs ?? 400;
  let state: PreviewState = initialPreview;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestId = 0;
  let controller: AbortController | undefined;
  let wantHtml = false;

  const update = (patch: Partial<PreviewState>) => {
    state = { ...state, ...patch };
    options.onUpdate(state);
  };

  async function run(yaml: string, path: string | null): Promise<void> {
    const id = ++latestId;
    controller?.abort();
    controller = new AbortController();
    update({ rendering: true, source: yaml });
    try {
      const result = await options.render(yaml, path, controller.signal, wantHtml);
      if (id !== latestId) return; // a newer render has started
      if ("svg" in result)
        update({
          svg: result.svg,
          html: result.html ?? null,
          wires: result.wires ?? {},
          warnings: result.warnings,
          error: null,
          rendering: false,
        });
      else update({ error: { message: result.error, line: result.line }, rendering: false });
    } catch (err) {
      if (id !== latestId || (err instanceof DOMException && err.name === "AbortError")) return;
      update({ error: { message: `Render request failed: ${String(err)}`, line: null }, rendering: false });
    }
  }

  return {
    /** Whether renders should also fetch the HTML document (only while it's on screen). */
    setWantHtml(value: boolean): void {
      wantHtml = value;
    },
    /** Call on every edit. */
    schedule(yaml: string, path: string | null): void {
      clearTimeout(timer);
      timer = setTimeout(() => void run(yaml, path), delayMs);
    },
    /** Render immediately (e.g. when a file is opened). */
    now(yaml: string, path: string | null): Promise<void> {
      clearTimeout(timer);
      return run(yaml, path);
    },
    /** Forget the diagram (e.g. when switching files). */
    reset(): void {
      clearTimeout(timer);
      latestId++;
      controller?.abort();
      state = initialPreview;
      options.onUpdate(state);
    },
    dispose(): void {
      clearTimeout(timer);
      latestId++;
      controller?.abort();
    },
  };
}
