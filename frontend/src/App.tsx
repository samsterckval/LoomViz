import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ApiError,
  createClient,
  type Client,
  type FileList,
  type GitStatus,
  type Session,
} from "./api/client";
import { planReload } from "./api/events";
import { takeLaunchToken } from "./api/token";
import { GitBadge } from "./GitBadge";
import { locateAt, locateComponent } from "./editor/locate";
import { YamlEditor, type EditorMarker, type YamlEditorHandle } from "./editor/YamlEditor";
import { createRenderScheduler, initialPreview, type PreviewState } from "./preview/renderScheduler";
import { Preview, type PreviewView } from "./preview/Preview";
import { SelectionPanel } from "./preview/SelectionPanel";
import type { Selection } from "./preview/selection";
import {
  buffersReducer,
  isDirty,
  persistBuffers,
  restoreBuffers,
  safeSessionStorage,
} from "./workspace/buffers";
import { FileTree } from "./workspace/FileTree";

type Status = { kind: "info" | "error"; text: string } | null;

const NEW_FILE_TEMPLATE = `# New harness. WireViz syntax: https://github.com/wireviz/WireViz/blob/master/docs/syntax.md
connectors:
  X1:
    pincount: 2
  X2:
    pincount: 2

cables:
  W1:
    wirecount: 2

connections:
  -
    - X1: [1-2]
    - W1: [1-2]
    - X2: [1-2]
`;

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
  return <Workbench client={client} />;
}

function Workbench({ client }: { client: Client }) {
  const [session, setSession] = useState<Session | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [buffers, dispatch] = useReducer(buffersReducer, {});
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(initialPreview);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<PreviewView>("diagram");
  const [selection, setSelection] = useState<Selection | null>(null);
  const editor = useRef<YamlEditorHandle>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const storage = useMemo(() => safeSessionStorage(), []);

  const scheduler = useMemo(
    () => createRenderScheduler({ render: client.render, onUpdate: setPreview }),
    [client],
  );
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  const buffer = active ? buffers[active] : undefined;
  const text = buffer?.text ?? "";
  const dirtyPaths = useMemo(
    () =>
      new Set(
        Object.values(buffers)
          .filter(isDirty)
          .map((b) => b.path),
      ),
    [buffers],
  );
  const deletedPaths = useMemo(
    () =>
      new Set(
        Object.values(buffers)
          .filter((b) => b.deletedOnDisk)
          .map((b) => b.path),
      ),
    [buffers],
  );

  const refreshFiles = useCallback(() => client.listFiles().then(setFiles), [client]);
  const refreshGit = useCallback(
    () => client.gitStatus().then(setGitStatus, () => setGitStatus(null)),
    [client],
  );

  /** Read a file from disk into its buffer (opening, or re-reading after a change on disk). */
  const loadFile = useCallback(
    async (path: string) => {
      try {
        const { text: content, etag } = await client.readFile(path);
        dispatch({ type: "loaded", path, text: content, etag });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) dispatch({ type: "deletedOnDisk", path });
        else setStatus({ kind: "error", text: `Could not read ${path}: ${String(err)}` });
      }
    },
    [client],
  );

  const openFile = useCallback(
    async (path: string) => {
      setActive(path);
      setSelection(null);
      setStatus(null);
      scheduler.reset();
      await loadFile(path);
    },
    [loadFile, scheduler],
  );

  // Initial load: session, files, git status, and unsaved buffers from before a reload.
  useEffect(() => {
    Promise.all([client.session(), client.listFiles()])
      .then(([s, f]) => {
        setSession(s);
        setFiles(f);
        void refreshGit();
        const restored = restoreBuffers(storage, s.workspace ?? "");
        if (Object.keys(restored.buffers).length) dispatch({ type: "restored", buffers: restored.buffers });
        // Re-read every restored file, so edits based on an older version show a conflict.
        for (const path of Object.keys(restored.buffers)) if (path !== restored.active) void loadFile(path);
        const first = restored.active ?? f.files[0];
        if (first) return openFile(first);
      })
      .catch((err: unknown) =>
        setLoadError(
          err instanceof ApiError && err.status === 401
            ? "The launch token is missing or out of date. Open the URL loomviz printed most recently."
            : `Could not reach the LoomViz back-end: ${String(err)}`,
        ),
      );
  }, [client, loadFile, openFile, refreshGit, storage]);

  // Live updates (FR-9, FR-34): reload files changed on disk, refresh the tree and git status.
  const [live, setLive] = useState(true);
  const latest = useRef({ buffers, active });
  useEffect(() => {
    latest.current = { buffers, active };
  });
  useEffect(() => {
    if (!session) return;
    return client.connectEvents((event) => {
      const { buffers: open, active: current } = latest.current;
      const plan = planReload(event, new Set(Object.keys(open)), current);
      for (const path of plan.reload) void loadFile(path);
      for (const path of plan.deleted) dispatch({ type: "deletedOnDisk", path });
      if (plan.refreshTree) void refreshFiles();
      if (plan.refreshGit) void refreshGit();
      if (plan.rerender && current) void scheduler.now(open[current]?.text ?? "", current);
    }, setLive);
  }, [client, loadFile, refreshFiles, refreshGit, scheduler, session]);

  // Keep unsaved buffers in sessionStorage (FR-8).
  useEffect(() => {
    if (session?.workspace) persistBuffers(storage, session.workspace, buffers, active);
  }, [buffers, active, session, storage]);

  // Render when the active file changes or is reloaded; edits schedule their own renders.
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  });
  const bufferVersion = buffer ? `${buffer.etag}|${buffer.savedText.length}|${buffer.conflict ? 1 : 0}` : "";
  useEffect(() => {
    if (active && bufferVersion) void scheduler.now(latestText.current, active);
  }, [active, bufferVersion, scheduler]);

  // Text changed outside the editor (reload, conflict resolved): update the editor's model.
  useEffect(() => {
    if (active && buffer) editor.current?.replaceText(active, buffer.text);
  }, [active, buffer]);

  const save = useCallback(async () => {
    if (!active || !buffer || !isDirty(buffer)) return;
    const content = buffer.text;
    try {
      const etag = await client.writeFile(active, content, buffer.etag || null);
      dispatch({ type: "saved", path: active, text: content, etag });
      setStatus({ kind: "info", text: `Saved ${active}` });
      if (!buffer.etag) void refreshFiles(); // re-created a deleted file
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        await loadFile(active); // shows the "changed on disk" choice
      } else {
        setStatus({ kind: "error", text: `Save failed: ${String(err)}` });
      }
    }
  }, [active, buffer, client, loadFile, refreshFiles]);

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

  // Warn before leaving with unsaved edits in any file.
  useEffect(() => {
    if (dirtyPaths.size === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyPaths]);

  // --- file tree actions (FR-7) -------------------------------------------------------------

  const createFile = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        await client.writeFile(path, NEW_FILE_TEMPLATE, null);
      } catch (err) {
        return err instanceof ApiError && err.status === 412 ? `${path} already exists` : String(err);
      }
      await refreshFiles();
      await openFile(path);
      return null;
    },
    [client, openFile, refreshFiles],
  );

  const renameFile = useCallback(
    async (from: string, to: string): Promise<string | null> => {
      try {
        await client.renameFile(from, to);
      } catch (err) {
        return err instanceof ApiError ? err.message : String(err);
      }
      dispatch({ type: "renamed", from, to });
      editor.current?.dropModel(from);
      if (active === from) setActive(to);
      await refreshFiles();
      return null;
    },
    [active, client, refreshFiles],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      const warning = dirtyPaths.has(path) ? " Its unsaved edits will be lost." : "";
      if (!window.confirm(`Delete ${path}?${warning}`)) return;
      try {
        if (!deletedPaths.has(path)) await client.deleteFile(path);
      } catch (err) {
        setStatus({ kind: "error", text: `Delete failed: ${String(err)}` });
        return;
      }
      dispatch({ type: "closed", path });
      editor.current?.dropModel(path);
      const list = await client.listFiles();
      setFiles(list);
      if (active === path) {
        const next = list.files[0];
        if (next) void openFile(next);
        else setActive(null);
      }
    },
    [active, client, deletedPaths, dirtyPaths, openFile],
  );

  // --- selection between diagram and editor (FR-31, FR-32) -----------------------------------

  const revealLine = useCallback((line: number) => editor.current?.revealLine(line), []);

  const markers = useMemo<EditorMarker[]>(
    () => (preview.error?.line ? [{ line: preview.error.line, message: preview.error.message }] : []),
    [preview.error],
  );

  const highlightLines = useMemo(() => {
    if (!selection) return [];
    const designator =
      selection.kind === "component" ? selection.designator : preview.wires[selection.key]?.cable;
    if (!designator) return [];
    const found = locateComponent(text, designator);
    return [found.definition, ...found.usages].flatMap((loc) => (loc ? [loc.line] : []));
  }, [selection, preview.wires, text]);

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

  const onCursor = useCallback(
    (offset: number) => {
      clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => {
        const designator = locateAt(text, offset);
        setSelection((current) => {
          if (!designator) return null;
          if (current?.kind === "component" && current.designator === designator) return current;
          return { kind: "component", designator };
        });
      }, 150);
    },
    [text],
  );
  useEffect(() => () => clearTimeout(cursorTimer.current), []);

  if (loadError) return <main className="message">{loadError}</main>;
  if (!session || !files) return <main className="message">Loading…</main>;

  if (!files.loom_folder_exists) {
    return (
      <main className="message">
        <h1>{session.workspace}</h1>
        <p>
          This folder has no <code>{files.loom_folder}/</code> subfolder yet. LoomViz keeps harness files
          there.
        </p>
        <button onClick={() => void client.createLoomFolder().then(refreshFiles)}>
          Create {files.loom_folder}/ folder
        </button>
      </main>
    );
  }

  return (
    <div className="app">
      <header>
        <strong>LoomViz</strong>
        <span className="repo">{session.workspace}</span>
        <GitBadge status={gitStatus} />
        {!live && (
          <span className="status error" title="Changes made on disk won't show until the connection is back">
            reconnecting…
          </span>
        )}
        <span className="spacer" />
        {active && <span className="current-file">{active}</span>}
        <button onClick={() => void save()} disabled={!isDirty(buffer)} title="Save (Ctrl/Cmd+S)">
          Save
        </button>
        <span className={isDirty(buffer) ? "dirty" : "clean"}>
          {buffer ? (isDirty(buffer) ? "● unsaved" : "saved") : ""}
        </span>
        {status && <span className={`status ${status.kind}`}>{status.text}</span>}
      </header>
      <div className="panes">
        <FileTree
          files={files.files}
          active={active}
          dirty={dirtyPaths}
          deletedOnDisk={deletedPaths}
          onOpen={(path) => void openFile(path)}
          onCreate={createFile}
          onRename={renameFile}
          onDelete={(path) => void deleteFile(path)}
        />
        <section className="editor-pane" aria-label="Editor">
          {buffer?.conflict && (
            <div className="banner warning conflict" role="alert">
              <span>
                <strong>{active}</strong> changed on disk while you had unsaved edits.
              </span>
              <button onClick={() => dispatch({ type: "resolved", path: buffer.path, keep: "mine" })}>
                Keep my edits
              </button>
              <button onClick={() => dispatch({ type: "resolved", path: buffer.path, keep: "disk" })}>
                Reload from disk
              </button>
            </div>
          )}
          {buffer?.deletedOnDisk && (
            <div className="banner warning" role="alert">
              <strong>{active}</strong> was deleted on disk. Save to re-create it, or delete it here to
              discard your edits.
            </div>
          )}
          {active && buffer ? (
            <YamlEditor
              ref={editor}
              path={active}
              initialText={buffer.text}
              markers={markers}
              highlightLines={highlightLines}
              onCursor={onCursor}
              onChange={(next) => {
                dispatch({ type: "edited", path: active, text: next });
                scheduler.schedule(next, active);
              }}
            />
          ) : (
            <p className="message">
              {files.files.length ? "Pick a file on the left." : "No harness files yet: use + New."}
            </p>
          )}
        </section>
        <Preview
          state={preview}
          fitKey={active ?? ""}
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
            if (next === "document" && active) void scheduler.now(text, active);
          }}
        />
      </div>
    </div>
  );
}
