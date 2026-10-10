import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createClient,
  type Client,
  type FileList,
  type GitStatus,
  type Session,
} from "./api/client";
import { takeLaunchToken } from "./api/token";
import { GitBadge } from "./GitBadge";
import { locateComponent } from "./editor/locate";
import { createRenderScheduler, initialPreview, type PreviewState } from "./preview/renderScheduler";
import { Preview, type PreviewView } from "./preview/Preview";
import { SelectionPanel } from "./preview/SelectionPanel";
import type { Selection } from "./preview/selection";

interface OpenFile {
  path: string;
  savedText: string;
  etag: string;
}

type Status = { kind: "info" | "error" | "conflict"; text: string } | null;

export default function App() {
  const token = useMemo(() => takeLaunchToken(), []);
  const client = useMemo(() => (token ? createClient(token) : null), [token]);
  if (!client) {
    return (
      <main className="message">
        <h1>LoomViz</h1>
        <p>
          Open the URL that <code>loomviz</code> printed when it started. It contains <code>?token=…</code>.
        </p>
      </main>
    );
  }
  return <Editor client={client} />;
}

function Editor({ client }: { client: Client }) {
  const [session, setSession] = useState<Session | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewState>(initialPreview);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<PreviewView>("diagram");
  const [selection, setSelection] = useState<Selection | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  const scheduler = useMemo(
    () => createRenderScheduler({ render: client.render, onUpdate: setPreview }),
    [client],
  );
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  const dirty = open !== null && text !== open.savedText;

  const openFile = useCallback(
    async (path: string) => {
      const { text: content, etag } = await client.readFile(path);
      setOpen({ path, savedText: content, etag });
      setText(content);
      setStatus(null);
      setSelection(null);
      scheduler.reset();
      void scheduler.now(content, path);
    },
    [client, scheduler],
  );

  useEffect(() => {
    Promise.all([client.session(), client.listFiles()])
      .then(([s, f]) => {
        setSession(s);
        setFiles(f);
        void client.gitStatus().then(setGitStatus, () => setGitStatus(null));
        if (f.files.length > 0) return openFile(f.files[0]);
      })
      .catch((err: unknown) =>
        setLoadError(
          err instanceof ApiError && err.status === 401
            ? "The launch token is missing or out of date. Open the URL loomviz printed most recently."
            : `Could not reach the LoomViz back-end: ${String(err)}`,
        ),
      );
  }, [client, openFile]);

  const save = useCallback(async () => {
    if (!open || !dirty) return;
    try {
      const etag = await client.writeFile(open.path, text, open.etag);
      setOpen({ ...open, savedText: text, etag });
      setStatus({ kind: "info", text: `Saved ${open.path}` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setStatus({ kind: "conflict", text: `${open.path} changed on disk since you opened it.` });
      } else {
        setStatus({ kind: "error", text: `Save failed: ${String(err)}` });
      }
    }
  }, [client, open, text, dirty]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Select a line in the editor and scroll it into view (Monaco will do this properly in M2).
  const revealLine = useCallback(
    (line: number) => {
      const area = editor.current;
      if (!area) return;
      const lines = text.split("\n");
      const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
      const end = start + (lines[line - 1]?.length ?? 0);
      area.focus({ preventScroll: true });
      area.setSelectionRange(start, end);
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 19.5;
      area.scrollTop = Math.max(0, (line - 1) * lineHeight - area.clientHeight / 3);
    },
    [text],
  );

  const select = useCallback(
    (next: Selection | null) => {
      setSelection(next);
      if (!next) return;
      const designator = next.kind === "component" ? next.designator : preview.wires[next.key]?.cable;
      if (!designator) return;
      const found = locateComponent(text, designator);
      const target =
        next.kind === "wire" ? (found.usages[0] ?? found.definition) : (found.definition ?? found.usages[0]);
      if (target) revealLine(target.line);
    },
    [preview.wires, revealLine, text],
  );

  const switchTo = (path: string) => {
    if (dirty && !window.confirm(`Discard unsaved changes to ${open?.path}?`)) return;
    void openFile(path);
  };

  if (loadError) return <main className="message">{loadError}</main>;
  if (!session || !files) return <main className="message">Loading…</main>;

  return (
    <div className="app">
      <header>
        <strong>LoomViz</strong>
        <span className="repo">{session.workspace}</span>
        <GitBadge status={gitStatus} />
        <select
          value={open?.path ?? ""}
          onChange={(e) => switchTo(e.target.value)}
          disabled={files.files.length === 0}
          aria-label="Harness file"
        >
          {files.files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={() => void save()} disabled={!dirty} title="Save (Ctrl/Cmd+S)">
          Save
        </button>
        <span className={dirty ? "dirty" : "clean"}>{open ? (dirty ? "● unsaved" : "saved") : ""}</span>
        {status && (
          <span className={`status ${status.kind}`}>
            {status.text}
            {status.kind === "conflict" && open && (
              <button onClick={() => void openFile(open.path)}>Reload from disk (discard my edits)</button>
            )}
          </span>
        )}
      </header>
      {files.files.length === 0 ? (
        <main className="message">
          {files.loom_folder_exists ? (
            `No .yml files in ${files.loom_folder}/ yet.`
          ) : (
            <>
              <p>
                This folder has no <code>{files.loom_folder}/</code> subfolder yet. LoomViz keeps harness
                files there.
              </p>
              <button
                onClick={() =>
                  void client
                    .createLoomFolder()
                    .then(() => client.listFiles())
                    .then(setFiles)
                }
              >
                Create {files.loom_folder}/ folder
              </button>
            </>
          )}
        </main>
      ) : (
        <div className="panes">
          <textarea
            ref={editor}
            className="editor"
            value={text}
            spellCheck={false}
            wrap="off"
            aria-label="YAML editor"
            onChange={(e) => {
              setText(e.target.value);
              scheduler.schedule(e.target.value, open?.path ?? null);
            }}
          />
          <Preview
            state={preview}
            selection={selection}
            onSelect={select}
            panel={
              selection && (
                <SelectionPanel
                  selection={selection}
                  yamlText={text}
                  wires={preview.wires}
                  onReveal={revealLine}
                  onSelect={select}
                />
              )
            }
            view={view}
            onViewChange={(next) => {
              setView(next);
              scheduler.setWantHtml(next === "document"); // fetch the HTML only while it's on screen
              if (next === "document" && open) void scheduler.now(text, open.path);
            }}
          />
        </div>
      )}
    </div>
  );
}
