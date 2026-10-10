# SPEC: LoomViz, a web-based WireViz editor

Status: draft v0.8 (2026-10-10). v0.8 adds opt-in access from the local network (FR-35). This file says **what** LoomViz does. [PLAN.md](PLAN.md) says how and in what order we build it, and records the reasoning behind each decision.

v0.7 changes the model: LoomViz now **opens a folder on the user's machine**, and **git happens in the user's own tools** (VS Code, GitHub Desktop, the command line). Cloning, credentials, commit/push from the UI and the terminal are gone (PLAN D16). Requirement numbers are kept stable, so removed ones are marked as such.

## 1. Overview

LoomViz is a web application for designing wiring harness documentation, built on [WireViz](https://github.com/wireviz/WireViz). Users edit harness definitions in a YAML editor (and, later, through forms) and see the rendered diagram update live.

How it's used:

1. Start LoomViz on a folder, usually a git repository: `loomviz ~/my-harnesses` (or, later, one `docker compose up` with that folder mounted).
2. Open the URL it prints.
3. Edit the harness files in the folder's `loom/` subfolder, with a live diagram, WireViz's document view, and click-to-find between diagram and YAML.
4. Save. Commit and push with your usual git tool; LoomViz shows the branch and how many harness files have uncommitted changes, and reloads files that change on disk (after a `git pull` or a branch switch).

## 2. Glossary

| Term | Meaning |
|---|---|
| Workspace | The folder LoomViz was started on, usually the root of a git repository. One workspace per run. |
| Loom folder | The `loom/` folder at the workspace root. It holds the harness YAML files (and any images and templates they reference). LoomViz only reads and writes inside it. |
| Launch token | A random secret LoomViz generates at startup and prints in its URL. Every request to LoomViz must carry it. |
| Buffer | A file's content in the editor. It is *unsaved* (dirty) when it differs from the file on disk. |

## 3. Goals and non-goals

Goals:
- Live-rendered harness diagram (SVG) next to a proper YAML editor.
- Click a connector, cable or wire to find its YAML, and the reverse.
- WireViz's own document (diagram, BOM, drawing frame) one click away.
- Everything stored as plain WireViz YAML in the user's folder. No database, no proprietary format.
- Work well alongside the user's git tools: show the branch and uncommitted changes, and pick up changes made on disk.
- Forms for editing connectors, cables, connections and metadata without hand-writing YAML (later).
- Reuse the WireViz library; do not reimplement it.

Non-goals for v1:
- Any git write operation (commit, push, pull, branch). LoomViz only reads git status.
- Cloning repositories or handling git credentials.
- A terminal in the browser.
- Multi-user collaboration or hosted multi-tenant use. LoomViz is single-user; it runs locally, and can be opened from other machines on the user's own network (FR-35).
- Replacing WireViz's renderer or YAML format.
- Mobile layout.

## 4. Users

Engineers and hobbyists who design cable harnesses, keep them in git, and want diagrams versioned like code without hand-writing all the YAML. They already use a git client.

## 5. Principles

1. **The user's folder is the storage.** LoomViz reads and writes files there, nowhere else, and keeps no state of its own between runs.
2. **Git stays in the user's hands.** LoomViz never changes the repository; it only reads its status.
3. **YAML is the source of truth.** Forms edit the YAML; they never hold state the file doesn't.
4. **Round-trip safe.** Edits made by LoomViz (forms, later) keep comments, key order and formatting of untouched parts of the file.
5. **Never blank the preview.** Invalid or half-typed YAML shows an error while the last good diagram stays visible.

## 6. Release scope

| Release | Contents |
|---|---|
| **v0.1** | Start on a local folder; Monaco YAML editor with live preview, document view, two-way diagram/YAML selection; file tree; unsaved-edit recovery; reload on disk changes; read-only git status; zoom/pan. Runs natively (`uv`) and in Docker with the folder mounted. |
| Later: forms | Schema-driven forms for metadata, connectors, cables, connections, additional BOM items. |
| Later: v1.0 | Export (SVG, PNG, HTML, BOM), published multi-arch image, documentation. |

Every requirement below is tagged with its release.

## 7. User interface

One page:

```
+--------------------------------------------------------------------------+
| LoomViz  my-harnesses  ⎇ main · 2 files changed in loom/        [Save]    |
+-------------+--------------------------------+---------------------------+
| loom/       | Editor: harness.yml (Monaco)   | [Diagram | Document]  [⤢] |
|  a.yml ●    | (YAML; "Form" tab later)       | (SVG, zoom/pan, clickable;|
|  b.yml      |                                |  error banner on top,     |
|  sub/       |                                |  last good diagram stays) |
|   c.yml     |                                | Selection info panel      |
| [+ New]     |                                |                           |
+-------------+--------------------------------+---------------------------+
```

- The panes are resizable.
- The file tree marks files with unsaved edits (●).
- The header shows the workspace name and the git status (FR-34), or "not a git repository".
- The preview has two views: **Diagram** (the interactive SVG) and **Document** (WireViz's own HTML page: diagram, BOM and, if the harness asks for it, a drawing frame with title block).

## 8. Functional requirements

### 8.1 Workspace
- **FR-33** (v0.1): LoomViz is started on a folder (`loomviz <folder>`). If the folder has no `loom/` subfolder, the UI says so and offers to create it.
- **FR-34** (v0.1): The header shows the git branch and the number of files under `loom/` with uncommitted changes (modified, added, deleted or untracked), refreshed when files change. If the workspace isn't a git repository, it says so. LoomViz only ever runs read-only git commands.
- **FR-35** (v0.1): **LAN access, opt-in.** Started with `--lan` (natively) or `scripts/docker.sh --lan`, LoomViz is reachable from other machines on the local network, at the machine's host names and IP addresses (detected, plus any the user adds). The launch token is still required, and requests addressed to any other host name are still refused. With a TLS certificate and key, LoomViz serves HTTPS; without them it serves plain HTTP and warns that the token travels unencrypted on the network. Without `--lan`, nothing changes: local access only.
- **FR-36** (v0.1): **Server mode, one command.** `scripts/docker.sh <folder> --serve` starts LoomViz in Docker in the background with LAN access, keeps the same launch token across restarts (stored privately on the host), restarts it after a reboot, checks that it answers on the machine's LAN address, and prints the URLs to open from other computers. `--url` prints them again; `--stop` stops it.
- **FR-1 to FR-6**: *Removed in v0.7* (open-project form, clone, credentials, SSH; see PLAN D16).

### 8.2 Files and editing
- **FR-7** (v0.1): The file tree lists the `.yml`/`.yaml` files in the loom folder (recursively, subfolders allowed) and supports open, create, rename and delete (with confirmation). Files outside `loom/` are not shown. The folder name is fixed in v0.1.
- **FR-8** (v0.1): Saving is explicit (Ctrl/Cmd+S) and writes to disk. Several files can have unsaved edits at once; each is marked in the tree. Unsaved edits survive a page reload (kept in the browser tab's `sessionStorage`). Closing the tab with unsaved edits triggers the browser's "leave page?" warning.
- **FR-9** (v0.1): Files changed on disk by other tools (an editor, `git pull`, `git checkout`) are detected. Files without unsaved edits reload automatically; for files with unsaved edits, the user chooses between keeping their edits and reloading from disk. Files added or removed on disk appear in or disappear from the tree.
- **FR-10** (v0.1): The YAML editor is Monaco with YAML syntax highlighting, line numbers and folding, and marks render errors at their line.

### 8.3 Live preview
- **FR-11** (v0.1): Rendering is explicit: a **Render** button (and Ctrl/Cmd+Enter) renders the editor content, saved or not. Opening a file, reloading it from disk and switching to the Document view also render. After an edit, the button shows the diagram is out of date. An **Auto** option (off by default, remembered) renders after each edit with a debounce (400 ms) instead (PLAN D20). Images the harness references by relative path are resolved from the file's location inside `loom/` and embedded in the SVG, so the preview shows them.
- **FR-12** (v0.1): Stale renders are cancelled; only the latest result is shown.
- **FR-13** (v0.1): Render errors appear in a banner and in the editor, with line numbers where available. The last good diagram stays visible.
- **FR-14** (v0.1): Renders are cached by content hash.
- **FR-15** (v0.1): The diagram supports zoom (wheel, buttons), pan (drag) and fit-to-view. Dragging to pan doesn't count as a click.
- **FR-30** (v0.1): A **Document** view shows WireViz's HTML output for the current editor content: the diagram, the BOM table and, when `metadata.template` asks for one, the drawing template (e.g. `din-6771` with title block and sheet size). It updates like the diagram and is read-only. Only WireViz's built-in templates, or a template file inside `loom/`, can be used.
- **FR-31** (v0.1): Clicking a connector, cable or wire in the Diagram view selects it: the editor jumps to and highlights its definition (for a wire: the connection-set line that uses its cable), and an info panel shows its resolved attributes (after templates and `<<` merges) and every connection-set line that uses it. For a wire, the panel shows the cable, wire number, colour, gauge, length and both ends (connector, pin, pin label). Components WireViz generates itself (e.g. ferrules from `F.`) point to the entry that creates them.
- **FR-32** (v0.1): The reverse: when the editor cursor is on a connector or cable (its definition or a connection-set entry), that component is highlighted in the diagram and shown in the info panel. On a cable, its wires are highlighted too.

### 8.4 Git and terminal
- **FR-16 to FR-24**: *Removed in v0.7* (work state, commit/push, pull requests, end session, terminal; see PLAN D16). FR-22's unsaved-edits warning lives on in FR-8.

### 8.5 Forms (later)
- **FR-25**: Forms for metadata, connectors, cables, connections and additional BOM items. Other WireViz features remain editable in YAML.
- **FR-26**: Form and YAML edits stay in sync both ways. While the YAML doesn't parse, the form is read-only.
- **FR-27**: Forms are generated from a JSON Schema of the WireViz YAML.
- **FR-28**: Keys the forms don't know about are preserved, and only the edited node changes.

### 8.6 Export (later: v1.0)
- **FR-29**: Download the current harness as SVG, PNG, HTML document and BOM (TSV/CSV), using WireViz's own outputs.

## 9. Non-functional requirements

- **Security:** LoomViz can read and write files in the user's folder, so:
  - by default it listens on `127.0.0.1` only (in Docker: the port is published on `127.0.0.1` only); LAN access (FR-35) is an explicit opt-in;
  - every HTTP and WebSocket request needs the launch token and passes Origin/Host checks;
  - file access is confined to the loom folder (no `..`, absolute paths or symlinks escaping it);
  - git commands are read-only, run with a timeout and with repository-configured helpers disabled where possible;
  - diagrams and documents are built from file content, so they are treated as untrusted: the Diagram view inserts the SVG into the page only after sanitising it (no scripts, event handlers, external references or embedded HTML), and the Document view runs in a sandboxed frame with scripts and external loads blocked;
  - LAN access relies on the launch token alone (no user accounts), so it's meant for the user's own, trusted network; HTTPS is supported and recommended there, and exposure to the internet stays out of scope for v1.
- **Performance:** a typical harness (under ~20 connectors) renders in under 1 s end to end. Large harnesses may take a few seconds but never freeze the UI.
- **Ease of use:** one command starts the complete app: `scripts/dev.sh <folder>` natively, or `docker compose up` with the folder configured.
- **Portability:** macOS and Linux natively (needs Python via uv, Node/pnpm for building, Graphviz); Docker on Linux and macOS (amd64 and arm64); Windows via WSL or Docker Desktop is acceptable. In Docker, files written to the mounted folder are owned by the user, not root.
- **Compatibility:** a pinned, tested WireViz version; the supported range is documented.
- **Offline use:** the UI loads without internet access (all assets bundled, including Monaco).

## 10. Architecture

```
Browser: React + TypeScript
  file tree | Monaco YAML editor | Diagram (sanitised inline SVG) / Document (sandboxed iframe) | info panel
        |  HTTP + WebSocket, launch token, 127.0.0.1 only
FastAPI back-end (Python 3.12), natively or in Docker
  files    list/read/write/rename/delete inside loom/
  watch    file changes in loom/ and git HEAD -> WebSocket events
  git      read-only status (branch, changed files in loom/)
  render   wireviz library -> SVG, HTML document, wire info (worker processes)
        |
User's folder (a git repository with loom/), mounted into the container when run in Docker
```

### Tech stack

| Layer | Choice |
|---|---|
| Back-end | Python 3.12, FastAPI, uvicorn |
| Rendering | `wireviz` library (pinned) + Graphviz |
| File watching | `watchfiles` |
| Git | `git` CLI, read-only commands |
| YAML (back-end) | PyYAML (as wireviz uses); ruamel.yaml only in the spike |
| YAML (front-end) | `yaml` npm package with `{ merge: true }` (locating, later form edits) |
| Front-end | React, TypeScript, Vite |
| Editor | Monaco, bundled locally |
| Sanitising | DOMPurify (SVG profile) |
| Forms (later) | react-jsonschema-form or equivalent, from a JSON Schema |
| Packaging | Native via `scripts/dev.sh`; one Docker image + `compose.yaml` |

## 11. API

All endpoints need the launch token.

Workspace:
- `GET /api/session`: `{state: "open", workspace: "<folder name>", loom_folder_exists}`.
- `POST /api/loom`: create the `loom/` folder (FR-33).
- `GET /api/git/status`: `{repository: false}` or `{repository: true, branch, detached, changed: [{path, status}]}` for files under `loom/` (FR-34).

Files and rendering (all file paths are relative to the loom folder and cannot leave it):
- `GET /api/files`: `{loom_folder_exists, files: [...]}`, the YAML files in `loom/`.
- `GET /api/files/{path}`: read a file (with `ETag`).
- `PUT /api/files/{path}`: write a file (`If-Match` for existing files, `If-None-Match: *` for new ones).
- `POST /api/files/{path}/rename`, `DELETE /api/files/{path}`.
- `POST /api/render`: `{yaml, path?, html?}` → `{svg, html?, wires, warnings}` or `{error, line?}`. `path` (relative to `loom/`) is the file being edited; relative image paths and custom templates resolve against it. `html: true` also returns WireViz's HTML document (FR-30). Wire edges in the SVG carry ids `wire-<cable>-<n>-a|b`; `wires` describes each wire as WireViz resolved it (FR-31).
- Later: `GET /api/schema` (forms), `POST /api/export` (export).

WebSocket:
- `WS /ws/events?token=…`: `{type: "files", changed: [...], added: [...], deleted: [...]}` and `{type: "git"}` (git status may have changed).

## 12. Definition of done for v0.1

On macOS and Linux:

- One command starts LoomViz on a folder, natively and in Docker.
- Open a harness, edit it in Monaco, and see the diagram update within about a second for a typical harness; invalid YAML shows an error at its line and keeps the last diagram.
- Clicking a wire, connector or cable finds its YAML; moving the cursor in the YAML highlights the matching part of the diagram.
- The Document view shows WireViz's page with BOM and drawing frame.
- Create, rename and delete files; unsaved edits in several files survive a reload.
- After `git pull` or `git checkout` in another tool, unchanged files reload and the header's branch and change count update.
- Zoom, pan and fit the diagram.
