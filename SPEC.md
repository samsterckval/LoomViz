# SPEC: LoomViz, a web-based WireViz editor

Status: draft v0.5 (2026-10-10). This file says **what** LoomViz does. [PLAN.md](PLAN.md) says how and in what order we build it, and records the reasoning behind each decision.

## 1. Overview

LoomViz is a web application for designing wiring harness documentation, built on [WireViz](https://github.com/wireviz/WireViz). Users edit harness definitions in a YAML editor (and, later, through forms) and see the rendered diagram update live.

LoomViz runs as a **stateless Docker container**. It keeps nothing between runs: every session starts by cloning a git repository and ends by pushing back to it. The git remote is the only durable storage.

A session:

1. Run one command (`docker compose up`) and open the URL it prints.
2. Enter a repository URL, a git token (not needed for public repos), the branch, and the author name and email for commits.
3. LoomViz clones the repository into memory-backed storage inside the container.
4. Edit harness files in the browser, and use the built-in terminal for anything else.
5. Commit and push back to the branch that was cloned.
6. Click "End session". LoomViz wipes the clone and credentials and the container stops.

## 2. Glossary

| Term | Meaning |
|---|---|
| Session | One run of the container, from opening a repository to "End session". One repository per session. |
| Working tree | The cloned repository inside the container. Within a session, it is the single source of truth: editor, renderer and terminal all work on it. |
| Loom folder | The `loom/` folder at the root of the repository. It holds the harness YAML files (and any images they reference). The file tree and file API only see this folder; the terminal and git see the whole repository. |
| Git token | The user's credential for the git host (personal access token or app password). |
| Launch token | A random secret LoomViz generates at startup and prints in its URL. Every request to LoomViz must carry it. Unrelated to git. |
| Work state | Where the user's changes are: unsaved (in the editor only), uncommitted, unpushed, or all pushed. |

## 3. Goals and non-goals

Goals:
- Live-rendered harness diagram (SVG) next to the YAML editor.
- Everything stored as plain WireViz YAML in the user's git repository. No database, no proprietary format.
- A guided, minimal git flow: open a repository, see what changed, commit, push.
- Zero persistent state in the container.
- A terminal with a real shell on the working tree, for anything the guided flow doesn't cover.
- Forms for editing connectors, cables, connections and metadata without hand-writing YAML (after v0.1).
- Reuse the WireViz library; do not reimplement it.

Non-goals for v1:
- A full git client. Branching, merging and conflict resolution beyond "pull and retry" happen in the terminal.
- Keeping anything between sessions (repositories, credentials, settings).
- Multi-user collaboration or hosted multi-tenant use. LoomViz is single-user and runs locally.
- Git submodules and Git LFS.
- Replacing WireViz's renderer or YAML format.
- Mobile layout.

## 4. Users

Engineers and hobbyists who design cable harnesses, keep them in a git hosting service (GitHub, GitLab, Bitbucket, Gitea/Forgejo, self-hosted), and want diagrams versioned like code without hand-writing all the YAML.

## 5. Principles

1. **The remote is the only durable storage.** Work counts as saved once it is pushed, and the UI always shows the work state.
2. **Nothing persists in the container.** Working tree, credentials and temporary files live in memory-backed storage and are gone when the container stops.
3. **Credentials are handled with care.** Never written to the image, a volume, logs, browser storage or the repository's `.git/config`, and never sent back to the browser.
4. **YAML is the source of truth.** Forms edit the YAML; they never hold state the file doesn't.
5. **Round-trip safe.** Form edits keep comments, key order and formatting of untouched parts of the file.
6. **Never blank the preview.** Invalid or half-typed YAML shows an error while the last good diagram stays visible.

## 6. Release scope

| Release | Contents |
|---|---|
| **v0.1** | Open a repository with a git token (or none), edit YAML with live preview, manage files, commit and push to the cloned branch, terminal, end session. Stateless Docker setup. |
| Later: forms | Schema-driven forms for metadata, connectors, cables, connections, additional BOM items. |
| Later: git extras | SSH keys, push to a new branch, pull requests (GitHub and GitLab via API, a link elsewhere). |
| Later: v1.0 | Export (SVG, PNG, BOM), published multi-arch image, documentation. |

Every requirement below is tagged with its release.

## 7. User interface

One page, shown after a repository is open:

```
+-------------------------------------------------------------------------+
| LoomViz  repo-name  [branch: main]  (● 2 unpushed)  [Changes] [End session] |
+-----------+-------------------------------+-----------------------------+
| Files     | Editor: harness.yml            | Preview                     |
|  a.yml    | (YAML; "Form" tab later)       | (SVG, zoom/pan;             |
|  b.yml    |                                |  error banner on top,       |
|  sub/     |                                |  last good diagram stays)   |
+-----------+-------------------------------+-----------------------------+
| Terminal (collapsible bottom panel)                                     |
+-------------------------------------------------------------------------+
```

- Before a repository is open, the page shows only the "Open project" form.
- "Changes" opens a panel with the changed files, a diff per file, a commit message box, and Commit and Push buttons.
- "End session" runs the end-session flow (FR-21).

## 8. Functional requirements

### 8.1 Project session
- **FR-1** (v0.1): The "Open project" form asks for: repository URL (`https://` only in v0.1), authentication (none, or username + git token), branch (default: the remote's default branch), author name and email, and an optional shallow clone. It includes a short hint on creating a token for GitHub and GitLab.
- **FR-2** (v0.1): LoomViz clones the repository into memory-backed storage, shows progress, and reports failures clearly: authentication failed, repository or branch not found, network error, out of space.
- **FR-3** (v0.1): One repository per session. A different repository means ending the session and starting a new one.
- **FR-4** (v0.1): The git token is used for clone, pull and push, and is available to git in the terminal. It is never stored in `.git/config` or the remote URL, written to logs, or returned to the browser.
- **FR-5** (v0.1): Reloading the page, or reopening the launch URL while the container runs, returns to the open session.
- **FR-6** (later: git extras): SSH key authentication (upload or paste, optional passphrase), with `ssh://` and scp-style URLs. Host keys of GitHub, GitLab and Bitbucket are pre-trusted; for other hosts the user confirms the fingerprint.

### 8.2 Files and editing
- **FR-7** (v0.1): The file tree lists the `.yml`/`.yaml` files in the loom folder (recursively, subfolders allowed) and supports open, create, rename and delete (with confirmation). Files outside `loom/` are not shown. If the repository has no `loom/` folder, LoomViz says so after cloning and offers to create it; it appears in git with the first saved file. The folder name is fixed in v0.1.
- **FR-8** (v0.1): Saving is explicit (Ctrl/Cmd+S) and writes to the working tree. Open files show a dirty indicator. Unsaved editor content survives a page reload (kept in the browser tab's `sessionStorage`, which never holds credentials).
- **FR-9** (v0.1): Files changed by other means (terminal edits, `git pull`, `git checkout`) are detected. Open files without unsaved edits reload; files with unsaved edits show a conflict prompt.
- **FR-10** (v0.1): The YAML editor highlights syntax and marks render errors at their line.

### 8.3 Live preview
- **FR-11** (v0.1): After an edit and a debounce (default 400 ms), the editor content (saved or not) is rendered and the SVG shown. Images the harness references by relative path are resolved from the file's location inside `loom/` and embedded in the SVG, so the preview shows them.
- **FR-12** (v0.1): Stale renders are cancelled; only the latest result is shown.
- **FR-13** (v0.1): Render errors appear in a banner and in the editor, with line numbers where available. The last good diagram stays visible.
- **FR-14** (v0.1): Renders are cached by content hash.
- **FR-15** (v0.1): The preview supports zoom, pan and fit-to-view.

### 8.4 Save to remote
- **FR-16** (v0.1): The header always shows the branch and the work state: unsaved, uncommitted, unpushed (with count) or all pushed.
- **FR-17** (v0.1): The Changes panel lists changed files with a diff for each, and commits all changes (or a selection) with a message.
- **FR-18** (v0.1): Push sends commits to the branch that was cloned. If the remote has moved on, LoomViz offers "pull (rebase) and retry" and points to the terminal on conflicts. If the branch is protected or the token can't write, LoomViz says so and suggests pushing to another branch from the terminal.
- **FR-19** (later: git extras): Push to a new branch (default name `loomviz/<yyyy-mm-dd>-<short-slug>`).
- **FR-20** (later: git extras): Create a pull request after pushing to a new branch: title, description, target branch (default: the cloned branch). Via API on GitHub and GitLab (incl. self-hosted) with a git token; otherwise LoomViz shows the host's "create pull request" link.
- **FR-21** (v0.1): End session. If anything is unsaved, uncommitted or unpushed, LoomViz lists it and offers to save, commit and push it, or to discard it explicitly. Then it wipes the working tree and credentials, shows "Session ended, you can close this tab", and stops, which stops the container.
- **FR-22** (v0.1): Closing the tab while work is not pushed triggers the browser's "leave page?" warning.

### 8.5 Terminal
- **FR-23** (v0.1): A terminal panel gives an interactive bash shell with the working tree as its directory.
- **FR-24** (v0.1): Git in the terminal uses the session's credentials and author identity, so `git pull`, `git push` and pushing to other branches work without setup.

### 8.6 Forms (later)
- **FR-25**: Forms for metadata, connectors, cables, connections and additional BOM items. Other WireViz features remain editable in YAML.
- **FR-26**: Form and YAML edits stay in sync both ways. While the YAML doesn't parse, the form is read-only.
- **FR-27**: Forms are generated from a JSON Schema of the WireViz YAML.
- **FR-28**: Keys the forms don't know about are preserved, and only the edited node changes.

### 8.7 Export (later: v1.0)
- **FR-29**: Download the current harness as SVG, PNG and BOM (TSV/CSV), using WireViz's own outputs.

## 9. Non-functional requirements

- **Statelessness:** read-only root filesystem, no volumes or bind mounts; every writable path is tmpfs. After the container stops, nothing from the session remains on the host or in Docker. (Exception, documented: on Linux hosts with swap, memory pages can be swapped to disk.)
- **Security:** LoomViz offers a shell and holds the user's git credentials, so:
  - the port is published on `127.0.0.1` only;
  - every HTTP and WebSocket request needs the launch token and passes Origin/Host checks;
  - git operations started by LoomViz allow only `https` (plus `ssh` later), never run repository hooks, and don't fetch submodules;
  - any non-local deployment needs real authentication first and is out of scope for v1.
- **Performance:** a typical harness (under ~20 connectors) renders in under 1 s end to end. Large harnesses may take a few seconds but never freeze the UI.
- **Repository size:** up to the configured working-tree size (default 1 GB); shallow clone for larger repositories.
- **Ease of use:** one command starts the complete app on a machine with only Docker.
- **Portability:** Docker on Linux and macOS (amd64 and arm64); Windows via Docker Desktop/WSL is acceptable.
- **Compatibility:** a pinned, tested WireViz version; the supported range is documented.
- **Offline use:** the UI loads without internet access (all assets bundled). Only the git remote needs the network.

## 10. Architecture

```
Browser: React + TypeScript
  Open-project form | file tree | Monaco YAML editor | SVG preview | Changes panel | xterm.js terminal
        |  HTTP + WebSocket, launch token, 127.0.0.1 only
Docker container (read-only root filesystem, non-root user)
  FastAPI back-end (Python 3.12)
    session   open/clone, credentials, work state, end session
    git       status, diff, commit, pull, push (git CLI)
    files     list/read/write in the working tree
    render    wireviz library -> SVG (worker processes)
    terminal  bash in a PTY
  tmpfs: /workspace (working tree), /run/loomviz (credentials, git config), /tmp, $HOME
        |
Git remote (GitHub, GitLab, ...)  <- the only durable storage
```

### Tech stack

| Layer | Choice |
|---|---|
| Back-end | Python 3.12, FastAPI, uvicorn |
| Rendering | `wireviz` library (pinned) + Graphviz |
| Git | `git` CLI via subprocess, credential helper for HTTPS |
| YAML (back-end) | ruamel.yaml (validation, round-trip tests) |
| YAML (front-end) | `yaml` npm package, Document API (comment-preserving form edits, later) |
| Front-end | React, TypeScript, Vite |
| Editor | Monaco with `monaco-yaml`, bundled locally |
| Terminal | xterm.js, `ptyprocess` on the back-end |
| Forms (later) | react-jsonschema-form or equivalent, from a JSON Schema |
| Packaging | One Docker image + `compose.yaml` |

## 11. API

All endpoints need the launch token. Everything except `/api/session` needs an open session.

Session:
- `GET /api/session`: `{state: "none" | "cloning" | "open" | "ending", repo?, branch?, work_state?}`
- `POST /api/session`: `{url, auth: {kind: "none"} | {kind: "https", username, token}, branch?, author: {name, email}, shallow?}`; starts the clone. Later: `{kind: "ssh", key, passphrase?}`.
- `DELETE /api/session`: end the session. Returns 409 with the outstanding uncommitted/unpushed work unless `{discard: true}`. (Unsaved editor buffers are checked by the browser before calling this.)
- Later: `POST /api/session/hostkey` to confirm an SSH host key.

Git:
- `GET /api/git/status`: changed files, ahead/behind counts.
- `GET /api/git/diff?path=…`: diff for one file.
- `POST /api/git/commit`: `{message, paths?}`.
- `POST /api/git/push`: push the current branch. Returns success or a typed rejection (`non_fast_forward`, `protected`, `auth`, `network`). Later: `{new_branch}`.
- `POST /api/git/pull`: pull with rebase.
- Later: `POST /api/git/pr`: `{title, body, base}`, returns the pull request URL.

Files and rendering (all file paths are relative to the loom folder and cannot leave it):
- `GET /api/files`: `{loom_folder_exists, files: [...]}`, the YAML files in `loom/`.
- `GET /api/files/{path}`: read a file (with `ETag`).
- `PUT /api/files/{path}`: write a file (`If-Match` for conflict detection).
- `POST /api/files/{path}/rename`, `DELETE /api/files/{path}`.
- `POST /api/render`: `{yaml, path?}` → `{svg, warnings}` or `{error, line?}`. `path` (relative to `loom/`) is the file being edited; relative image paths resolve against it.
- Later: `GET /api/schema` (forms), `POST /api/export` (export).

WebSockets:
- `WS /ws/session`: clone progress, file changes, work-state updates.
- `WS /ws/terminal`: PTY stream.

## 12. Definition of done for v0.1

On macOS (Docker Desktop) and Linux:

- With only Docker installed, one command starts LoomViz.
- Open a private GitHub repository of WireViz files with a git token.
- Edit a file and see the diagram update within about a second for a typical harness; invalid YAML shows an error and keeps the last diagram.
- Create, rename and delete a file; save.
- Commit and push to the cloned branch from the UI; a rejected push can be resolved with "pull and retry".
- In the terminal, `git log` and `git pull` work without setup.
- End the session: the container stops, and neither Docker nor the host holds any trace of the working tree or the git token.
