// Monaco YAML editor (SPEC FR-10), bundled locally: only the editor core and YAML highlighting
// are imported, and the worker is built by Vite. The rest of the app talks to it through props
// and the small imperative handle below, so Monaco stays out of everything else.
//
// One Monaco model per file path: switching files keeps each file's undo history and scroll.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/yaml/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export interface EditorMarker {
  line: number;
  message: string;
}

export interface YamlEditorHandle {
  /** Scroll to a line, select it and focus the editor. */
  revealLine(line: number): void;
  /** Replace a file's text (e.g. reloaded from disk) as an undoable edit, keeping the cursor. */
  replaceText(path: string, text: string): void;
  /** Forget a file's model (closed, deleted or renamed). */
  dropModel(path: string): void;
}

interface Props {
  path: string;
  /** Text to use when the file's model is created; afterwards the model is the source of truth. */
  initialText: string;
  onChange: (text: string) => void;
  /** Cursor moved (by the user) to this character offset. */
  onCursor?: (offset: number) => void;
  /** Ctrl/Cmd+Enter pressed in the editor (render now). */
  onRenderShortcut?: () => void;
  markers?: EditorMarker[];
  /** Lines to highlight (e.g. the selected component's definition and usages). */
  highlightLines?: number[];
}

const MARKER_OWNER = "loomviz-render";
const uriFor = (path: string) => monaco.Uri.parse(`loom:///${encodeURI(path)}`);

function modelFor(path: string, text: string): monaco.editor.ITextModel {
  const uri = uriFor(path);
  return monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, "yaml", uri);
}

const darkQuery =
  typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
const themeName = () => (darkQuery?.matches ? "vs-dark" : "vs");

export const YamlEditor = forwardRef<YamlEditorHandle, Props>(function YamlEditor(
  { path, initialText, onChange, onCursor, onRenderShortcut, markers = [], highlightLines = [] },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const programmatic = useRef(false); // true while we change the text ourselves
  const callbacks = useRef({ onChange, onCursor, onRenderShortcut });

  useEffect(() => {
    callbacks.current = { onChange, onCursor, onRenderShortcut };
  });

  // Create the editor once.
  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      automaticLayout: true,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      renderWhitespace: "boundary",
      theme: themeName(),
      wordWrap: "off",
      fixedOverflowWidgets: true,
    });
    editor.current = instance;
    // Monaco handles Ctrl/Cmd+Enter itself (insert line below), so register "render" here.
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      callbacks.current.onRenderShortcut?.(),
    );
    decorations.current = instance.createDecorationsCollection();
    const changes = instance.onDidChangeModelContent(() => {
      if (!programmatic.current) callbacks.current.onChange(instance.getValue());
    });
    const cursor = instance.onDidChangeCursorPosition((e) => {
      const model = instance.getModel();
      // Only react to the user's own moves, not to our reveal/selection calls.
      if (model && e.source !== "api" && !programmatic.current)
        callbacks.current.onCursor?.(model.getOffsetAt(e.position));
    });
    const onTheme = () => monaco.editor.setTheme(themeName());
    darkQuery?.addEventListener("change", onTheme);
    return () => {
      changes.dispose();
      cursor.dispose();
      darkQuery?.removeEventListener("change", onTheme);
      instance.dispose();
      editor.current = null;
    };
  }, []);

  // Switch to the file's model (created on first open).
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const model = modelFor(path, initialText);
    if (instance.getModel() !== model) instance.setModel(model);
    // initialText only matters when the model is created; later changes go through replaceText.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Render errors as markers (squiggle + hover message).
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      markers
        .filter((m) => m.line >= 1 && m.line <= model.getLineCount())
        .map((m) => ({
          severity: monaco.MarkerSeverity.Error,
          message: m.message,
          startLineNumber: m.line,
          endLineNumber: m.line,
          startColumn: model.getLineFirstNonWhitespaceColumn(m.line) || 1,
          endColumn: model.getLineMaxColumn(m.line),
        })),
    );
  }, [markers, path]);

  // Highlight lines of the current selection.
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model || !decorations.current) return;
    decorations.current.set(
      highlightLines
        .filter((line) => line >= 1 && line <= model.getLineCount())
        .map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "selected-line",
            linesDecorationsClassName: "selected-line-gutter",
          },
        })),
    );
  }, [highlightLines, path]);

  useImperativeHandle(ref, () => ({
    revealLine(line: number) {
      const instance = editor.current;
      const model = instance?.getModel();
      if (!instance || !model || line < 1 || line > model.getLineCount()) return;
      programmatic.current = true;
      instance.revealLineInCenterIfOutsideViewport(line);
      instance.setSelection(
        new monaco.Selection(
          line,
          model.getLineFirstNonWhitespaceColumn(line) || 1,
          line,
          model.getLineMaxColumn(line),
        ),
      );
      programmatic.current = false;
      instance.focus();
    },
    replaceText(targetPath: string, text: string) {
      const model = monaco.editor.getModel(uriFor(targetPath));
      if (!model || model.getValue() === text) return;
      programmatic.current = true;
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
      programmatic.current = false;
    },
    dropModel(targetPath: string) {
      monaco.editor.getModel(uriFor(targetPath))?.dispose();
    },
  }));

  return <div ref={container} className="editor" />;
});
