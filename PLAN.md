# PLAN: LoomViz

Status: 2026-10-10, for [SPEC.md](SPEC.md) v0.7. SPEC says **what** LoomViz does; this file says **how**, **in what order** and **why**. When a decision changes scope, update both.

v0.7 switched LoomViz to **opening a local folder, with git in the user's own tools** (D16). That removed cloning, credentials, commit/push and the terminal from the plan. The detailed M0/M1 step lists from before that switch are in git history (commit `0ee2346`).

## 1. Milestones

| Milestone | Delivers | Status |
|---|---|---|
| M0 | Feasibility spike: WireViz as a library, render speed, YAML round trips | Done (results in `spike/README.md`); git and container parts dropped |
| M1 | Back-end (launch token, file API, render service), live-preview page, document view, diagram selection | Done, except Docker (now M3) and CI |
| **M2** | **Editor and workspace: Monaco, two-way selection, file tree, unsaved-edit recovery, live reload, git status, zoom/pan, resizable layout** | **Next (§4)** |
| M3 | Docker: one image, `compose.yaml` with the folder mounted, files owned by the user | Later; needs Docker on the dev machine |
| M4 | Forms (SPEC FR-25 to FR-28) | Later |
| M5 | Export (FR-29), published image, docs, CI | Later (v1.0) |

v0.1 = M0 to M3.

## 2. Ground rules

- **Every step ends in one commit** on `main` (occasionally two, if noted). Each commit leaves lint and tests green.
- **Commit messages:** `<area>: <what>`, ending with the `Co-Authored-By` trailer.
- **"Verify"** is a test or a command you can run yourself, with the expected result.
- **Spike code lives in `spike/`** and is never imported by app code.

## 3. Done so far (M0, M1)

- **M0** (spike): rendering through `wireviz.parse()` in memory; benchmark (130 ms warm for a 5-connector harness, dominated by Graphviz start-up); ruamel.yaml can't load repeated `<<` keys and reformats on dump; the `yaml` npm package edits losslessly by splicing at node ranges (D7). JSON Schema reconnaissance (M0.7) waits for forms (M4). The container and git spikes (M0.8–M0.10) are dropped (D16); a container check comes back in M3.
- **M1** (prototype): FastAPI back-end with launch token, Host/Origin checks and bind rules; file API sandboxed to `loom/` with atomic writes and ETags; render service in worker processes with timeout, cache, error lines, image inlining, HTML document (D17) and wire ids; React page with debounced live preview, document view, sanitised clickable diagram and info panel. Docker (M1.10) moves to M3; CI (M1.11) waits for the GitHub repository.

## 4. M2: Editor and workspace

Goal: SPEC §12's definition of done, minus Docker. Order: back-end first where the front-end depends on it, then the editor, then the features that build on the editor.

### M2.1 Folder mode
- **Build:**
  - CLI becomes `loomviz <folder> [--port]` (positional; `--dev-workspace` goes away). Without a folder, it exits with a usage message.
  - `GET /api/session` returns `{state: "open", workspace, loom_folder_exists}`; the "dev mode" badge goes.
  - `POST /api/loom` creates the `loom/` folder (FR-33).
  - `scripts/dev.sh`, README and CLAUDE.md follow.
- **Verify:** `uv run pytest`: the session payload; `POST /api/loom` creates the folder and is idempotent. `scripts/dev.sh examples` starts; on a folder without `loom/`, the UI offers "Create loom/ folder" and the button creates it.
- **Commit:** `backend: folder mode (loomviz <folder>)`.

### M2.2 Read-only git status (FR-34)
- **Build:** `git.py`: `git -C <workspace> status --porcelain=v2 --branch --untracked-files=all -- loom/`, with `GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false`, `GIT_TERMINAL_PROMPT=0`, no shell and a 5 s timeout. Parses branch (or detached), and changed files with a simple status (modified, added, deleted, renamed, untracked). Not a repository, or no `git` installed → `{repository: false}`. `GET /api/git/status`. Header shows `⎇ main · 2 files changed in loom/` or "not a git repository".
- **Verify:** `uv run pytest tests/test_git.py`, against a temporary repository built in the test: clean repo → 0 changed; modified, new and deleted files under `loom/` are reported; changes outside `loom/` are ignored; detached HEAD; plain folder → `repository: false`; the command never writes to `.git` (`index` file unchanged).
- **Commit:** `backend: read-only git status`.

### M2.3 File watching and events (FR-9)
- **Build:**
  - `watch.py`: `watchfiles` watches `loom/` (YAML, images, templates) and `.git/HEAD` plus `.git/index`, if present. Changes are debounced (~200 ms), and LoomViz's own writes are reported too (the front-end ignores them by ETag).
  - `WS /ws/events?token=…` broadcasts `{type: "files", changed, added, deleted}` and `{type: "git"}`. The token and Origin/Host middleware already cover `/ws`.
  - The render cache already keys on referenced images' size and mtime, so a changed image re-renders.
- **Verify:** `uv run pytest tests/test_watch.py`: connecting without a token is refused; creating, modifying and deleting a file under `loom/` produce the matching events; touching `.git/HEAD` produces a `git` event; files outside `loom/` produce nothing.
- **Commit:** `backend: file watching and events WebSocket`.

### M2.4 Monaco editor (FR-10)
- **Build:**
  - Replace the textarea with Monaco (`monaco-editor`, bundled with Vite, workers included, no CDN).
  - YAML syntax highlighting, line numbers, folding, 2-space tabs.
  - Render errors become editor markers at their line (squiggle plus hover message).
  - A small `EditorHandle` (get/set text, reveal and highlight lines, cursor offset events) keeps Monaco out of the rest of the app.
  - Selection from the diagram (FR-31) uses Monaco's reveal and line decorations instead of the textarea hack.
  - `monaco-yaml` (schema validation) waits for the JSON Schema (M4).
- **Verify:** `pnpm build`; the built bundle loads no network resources outside the app (checked with headless Chrome: no requests to other hosts). Manual: open `demo02.yml`, fold a section, break the indentation and see the squiggle at the right line, click a wire and see its line highlighted.
- **Commit:** `frontend: Monaco editor with error markers`.

### M2.5 Cursor → diagram (FR-32)
- **Build:** `locateAt(yamlText, offset)` in `locate.ts`, the reverse of `locateComponent`. The cursor on:
  - a connector or cable key, or anywhere inside its definition → that component;
  - a connection-set entry (`- X1: [1-4]`, `- F.`) → that component;
  - anything else → nothing.

  Moving the cursor (debounced ~150 ms) updates the selection, which highlights the component in the diagram and shows it in the info panel. On a cable, its wires are highlighted too. Selections made by the cursor don't move the cursor back.
- **Verify:** `pnpm test`: `locateAt` on `demo02.yml` for a definition key, a nested attribute line, each connection-set entry kind, a template, metadata and broken YAML. Manual: put the cursor on `- W3: [1-4]` and see W3 and its four wires light up.
- **Commit:** `frontend: editor cursor highlights the diagram`.

### M2.6 File tree and buffers (FR-7, FR-8)
- **Build:**
  - Collapsible folders.
  - "New file" (name with an optional subfolder; `.yml` added if missing), rename (inline) and delete (with confirmation); errors from the API (409, 400) are shown inline.
  - A buffer store keeps the open and unsaved files in memory. Switching files keeps unsaved edits (no more "discard?" prompt), and dirty files are marked ●.
  - Unsaved buffers (text plus the ETag they were based on) are mirrored to `sessionStorage` and restored after a reload.
  - The `beforeunload` warning covers all dirty buffers.
- **Verify:** `pnpm test`: the buffer store (dirty tracking across files, restore from `sessionStorage`, storage unavailable) and tree building from the flat file list. Manual: edit two files without saving, reload, both still dirty with the edits; rename and delete work; creating `sub/new` gives `sub/new.yml`.
- **Commit:** `frontend: file tree and multi-file buffers`.

### M2.7 Live reload and git status in the UI (FR-9, FR-34)
- **Build:**
  - The front-end subscribes to `/ws/events` and reconnects with back-off.
  - On `files` events, the tree refreshes. A changed file without unsaved edits reloads (unless the disk ETag equals the buffer's, i.e. our own save). A changed file with unsaved edits shows "Changed on disk: keep my edits / reload". A deleted file with unsaved edits stays open, marked "deleted on disk".
  - On `git` and `files` events, the header's git status refreshes.
- **Verify:** `pnpm test`: the reconcile logic (clean vs dirty buffer, own save, deletion). Manual: with `examples/` as the workspace, run `git stash` or edit `demo02.yml` in another editor; LoomViz reloads it and the header count changes; then make an unsaved edit and change the file on disk again; the prompt appears.
- **Commit:** `frontend: live reload and git status`.

### M2.8 Zoom, pan and fit (FR-15)
- **Build:** a small pan/zoom wrapper around the diagram (CSS transform): wheel or trackpad pinch to zoom around the pointer, drag to pan, and +/−/Fit buttons. Fit runs when a new file is opened, and the view is kept across re-renders of the same file. A drag of more than a few pixels doesn't count as a click.
- **Verify:** `pnpm test`: the zoom-around-point and fit maths, plus the drag-vs-click threshold. Manual: zoom into W1, pan, click a wire (selects), drag (doesn't select), press Fit.
- **Commit:** `frontend: zoom, pan and fit for the diagram`.

### M2.9 Resizable layout
- **Build:** draggable dividers between file tree, editor and preview. Sizes are kept in `localStorage` (a per-viewer convenience; works without it). Monaco re-lays out on resize.
- **Verify:** Manual: drag both dividers, reload, sizes kept; the editor and diagram fill their panes.
- **Commit:** `frontend: resizable panes`.

### M2.10 Wrap-up
- **Build:** README "Try it" updated; CLAUDE.md commands and architecture notes updated; this plan's progress updated; the headless-Chrome smoke script from M1 kept as `scripts/ui-smoke.mjs` (opens the app, clicks a wire, checks the panel, toggles Document).
- **Verify:** from a fresh clone: `scripts/dev.sh examples`, then `node scripts/ui-smoke.mjs <url>` passes; all tests and lint pass.
- **Commit:** `docs: M2 wrap-up`.

**M2 exit criteria:** SPEC §12 holds natively on macOS (Docker items wait for M3); all tests pass.

## 5. Later milestones (outline)

- **M3, Docker:** multi-stage image (Node build, then Python + Graphviz + git); `compose.yaml` mounting `${WORKSPACE}` at `/workspace`, port published on `127.0.0.1`, running as the host user (`user: "${UID}:${GID}"`), read-only root filesystem with tmpfs `/tmp`; file watching checked on Docker Desktop's bind mounts (polling fallback); smoke test.
- **M4, forms:** JSON Schema reconnaissance (old M0.7), then forms with splice-based edits (D7).
- **M5, v1.0:** export, published multi-arch image, CI, docs.

## 6. Resolved questions

| # | Question | Answer |
|---|---|---|
| Q1 | Which `.yml` files count as harnesses? | Only those in `loom/` (D13). |
| Q2 | Images referenced by relative path | Supported: images resolve relative to the file, sandboxed to `loom/`, inlined into the SVG (D14). |
| Q3 | WireViz version and examples | Latest PyPI release (0.4.1); examples from upstream. |
| Q4 | Test repository for the git spike | No longer needed (D16). |
| Q5 | Repository workflow | Commit straight to `main`, one commit per step. CI waits for the GitHub repository. |
| Q6 | Clone a repo, or open a local folder? | Open a local folder, served by the back-end; git in the user's own tools (D16). |

## 7. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **Explicit save** (Ctrl/Cmd+S). Rendering always uses the editor content, saved or not. Committing happens in the user's git tool (D16). | Keeps commits meaningful; preview stays live without saving. |
| D2 | **React** for the front-end. | Mature bindings for Monaco and form libraries. |
| D3 | **Forms cover a core subset**; everything else stays editable in YAML and is preserved. | Full WireViz coverage is a moving target; YAML is the escape hatch. |
| D4 | **JSON Schema:** upstream if it exists, else generated from WireViz's dataclasses plus overrides. *To confirm before M4.* | Tracks upstream changes with little manual work. |
| D5 | *Superseded by D16.* Stateless Docker that clones and pushes; no volumes. | |
| D6 | **LoomViz, GPL-3.0.** | WireViz is GPL-3.0 and is imported as a library. |
| D7 | **YAML edits made by LoomViz** (forms) happen in the browser with the `yaml` package (`{ merge: true }`) as **text splices at node ranges**, never by re-serialising the document. The back-end never writes YAML through ruamel. *Confirmed in M0.6.* | Re-serialising rewrites WireViz's connection layout; ruamel can't load repeated `<<` keys. |
| D8–D10 | *Superseded by D16* (git token credentials, no PRs in v0.1, push to the cloned branch). | |
| D11 | **Unsaved editor content in `sessionStorage`.** | Survives a reload, gone with the tab. |
| D12 | *Superseded by D15.* SVG preview as an `<img>`. | |
| D13 | **Harness files live in a fixed `loom/` folder** at the workspace root; the file API is sandboxed to it. | Separates harnesses from other YAML without guessing; tight sandbox root. |
| D14 | **Images in the preview** resolve relative to the edited file, sandboxed to `loom/`, inlined as data URIs. | Self-contained preview. |
| D15 | **Interactive diagram:** the SVG is inserted inline after DOMPurify sanitising; the Document view stays in an `<iframe sandbox>` with a blocking CSP. | Selection needs DOM access; sanitising keeps the launch token out of reach. |
| D16 | **Open a local folder; git stays in the user's tools.** The back-end serves the folder it was started on (natively, or mounted into Docker in M3). LoomViz shows read-only git status and reloads files changed on disk, but never runs git write commands, handles credentials or offers a terminal. | Much smaller and safer: no credential handling, no shell in the browser, no clone/push edge cases. Users already have git tools. Works in every browser, unlike the File System Access API (the other option considered), and supports file watching. |
| D17 | **HTML document from the same harness**, with template names restricted to built-ins or files inside `loom/`. | One Graphviz run; WireViz resolves template names as file paths. |
