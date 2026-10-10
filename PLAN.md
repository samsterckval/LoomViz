# PLAN: LoomViz

Status: 2026-10-10, for [SPEC.md](SPEC.md) v0.7. SPEC says **what** LoomViz does; this file says **how**, **in what order** and **why**. When a decision changes scope, update both.

v0.7 switched LoomViz to **opening a local folder, with git in the user's own tools** (D16). That removed cloning, credentials, commit/push and the terminal from the plan. The detailed M0/M1 step lists from before that switch are in git history (commit `0ee2346`).

## 1. Milestones

| Milestone | Delivers | Status |
|---|---|---|
| M0 | Feasibility spike: WireViz as a library, render speed, YAML round trips | Done (results in `spike/README.md`); git and container parts dropped |
| M1 | Back-end (launch token, file API, render service), live-preview page, document view, diagram selection | Done, except Docker (now M3) and CI |
| M2 | Editor and workspace: Monaco, two-way selection, file tree, unsaved-edit recovery, live reload, git status, zoom/pan, resizable layout | Done (§4) |
| **M3** | **Docker: one image, `compose.yaml` with the folder mounted, files owned by the user** | **Written, untested on Docker (§5); the user tests on Linux** |
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

**M2 result (2026-10-10):** all ten steps done, one commit each. Notes:
- M2.3 found that uvicorn had no WebSocket library (`websockets` added), invisible to the test client; `tests/test_server.py` now runs a real server.
- watchfiles' default filter ignores `.git`, so the git watcher passes `watch_filter=None`; merged event flags (macOS) are resolved against the disk.
- Monaco adds ~3 MB to the bundle (810 KB gzipped), accepted for offline use.
- Known gaps: clicking a wire's row inside the cable box selects the cable, not the wire; FR-32 selects components, not individual wires; mouse-wheel zooms (no wheel-to-scroll).

## 5. M3: Docker

Goal: SPEC §12's Docker items. One command starts LoomViz in a container on a folder of the user's choice, and everything works as it does natively: live preview, document view, selection, file tree, live reload and git status. Files LoomViz writes belong to the user, and the app is only reachable from the user's own machine.

Target user experience:

```bash
scripts/docker.sh ~/my-harnesses              # builds the image if needed, starts it, prints the URL
WORKSPACE=~/my-harnesses docker compose up    # the same without the helper script
```

Design points that shape the steps:

- **Ports and the Host check.** Inside the container the server listens on `0.0.0.0:8000`; compose publishes it as `127.0.0.1:${PORT:-8000}`. The Host/Origin checks must accept the *host-side* port the browser uses, so the server learns it through `LOOMVIZ_PUBLIC_PORT` (D18). Even if someone publishes the port on all interfaces, the Host check still rejects requests addressed to a LAN IP, and every request needs the token.
- **File ownership.** The container runs as the host user (`user: "${UID}:${GID}"`), so files LoomViz writes into the mounted folder belong to the user on Linux. Docker Desktop on macOS maps ownership itself. `scripts/docker.sh` fills in `UID`/`GID`; plain compose users set them in `.env` (`.env.example` shows how).
- **Git inside the container.** The image includes `git` for the read-only status. Git refuses to read repositories owned by another user ("dubious ownership"), which can happen with bind mounts, so the image's system git config marks `/workspace` as a safe directory. That's acceptable because LoomViz only reads (D16). Mount the **repository root**: if the mounted folder is a subfolder of a repository, or a git worktree whose metadata lives outside the mount, the header shows "not a git repository".
- **Hardening.** Read-only root filesystem, tmpfs `/tmp` (also `HOME`, for Graphviz's font cache), `cap_drop: [ALL]`, `no-new-privileges`, `init: true` (reaps render workers killed on timeout), and no network access needed at run time.
- **File watching on bind mounts.** inotify works on native Linux and usually through Docker Desktop's file sharing. If events don't arrive, `LOOMVIZ_POLL=1` switches watchfiles to polling (`WATCHFILES_FORCE_POLLING`); M3.4 checks which is needed.

### M3.0 Prerequisite: Docker on the test machine
- **Build:** nothing. Docker isn't installed on the development Mac; testing happens on a separate Linux machine (Q8).
- **Verify:** there, `docker version` shows a server and `docker compose version` works.
- **Commit:** none.

### M3.1 Container-friendly back-end settings
- **Build:**
  - `LOOMVIZ_PUBLIC_PORT`: the port the browser uses; defaults to `--port`. `allowed_hosts`, `allowed_origins` and the printed launch URL use it.
  - `LOOMVIZ_FRONTEND_DIST`: where the built front-end lives, as an alternative to `--frontend-dist`, since the installed package can't find `frontend/dist` relative to itself inside the image.
  - `LOOMVIZ_POLL=1`: sets `WATCHFILES_FORCE_POLLING` before the watchers start.
  - The printed launch URL always says `127.0.0.1:<public port>`, even when listening on `0.0.0.0`.
- **Verify:** `uv run pytest`: with `port=8000, public_port=8100`, a request with `Host: 127.0.0.1:8100` passes, `Host: 127.0.0.1:8000` is refused, and `Origin: http://localhost:8100` passes; the launch URL uses 8100; `LOOMVIZ_POLL=1` sets the watchfiles variable.
- **Commit:** `backend: settings for running in a container`.

### M3.2 Docker image
- **Build:**
  - `Dockerfile`, multi-stage:
    1. `node:22-slim` with pnpm (corepack) runs `pnpm install --frozen-lockfile && pnpm build`;
    2. `python:3.12-slim` installs `graphviz`, `fonts-dejavu-core` and `git` (apt, no recommends), copies `uv` from its official image, installs the back-end with `uv sync --frozen --no-dev` (bytecode compiled at build time, since the root filesystem is read-only at run time), and copies in the built front-end.
  - `git config --system --add safe.directory /workspace`.
  - Runs as a non-root default user (overridable by compose's `user:`), `HOME=/tmp`, `LOOMVIZ_ALLOW_REMOTE=1`, `LOOMVIZ_FRONTEND_DIST=/app/frontend`.
  - Entrypoint `loomviz /workspace --host 0.0.0.0 --port 8000`.
  - `HEALTHCHECK` opens a TCP connection to port 8000 (no new endpoint).
  - `.dockerignore` keeps out `node_modules`, `.venv`, `spike/`, `.git` and build output.
- **Verify:**
  - `docker build -t loomviz:dev .` succeeds; `docker image ls loomviz:dev` shows the size (expected a few hundred MB, mostly Graphviz).
  - `docker run --rm -p 127.0.0.1:8000:8000 -e LOOMVIZ_PUBLIC_PORT=8000 -v "$PWD/examples:/workspace" loomviz:dev` prints a launch URL; opening it shows `demo02.yml` rendered.
  - `docker run --rm loomviz:dev dot -V` and `git --version` work inside the image.
- **Commit:** `docker: multi-stage image`.

### M3.3 compose.yaml and the one-command script
- **Build:**
  - `compose.yaml`: one service, built from the Dockerfile (image `loomviz:dev`), with:
    - `${WORKSPACE:?set WORKSPACE to your harness folder}` mounted at `/workspace`;
    - `ports: ["127.0.0.1:${PORT:-8000}:8000"]` and `LOOMVIZ_PUBLIC_PORT=${PORT:-8000}`;
    - `user: "${UID:-1000}:${GID:-1000}"`;
    - `read_only: true`, tmpfs `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `init: true`;
    - `restart: "no"`, plus optional `LOOMVIZ_TOKEN` and `LOOMVIZ_POLL`.
  - `.env.example` documents `WORKSPACE`, `PORT`, `UID`, `GID`, `LOOMVIZ_TOKEN` and `LOOMVIZ_POLL`.
  - `scripts/docker.sh [folder] [--port N] [--poll]`: resolves the folder to an absolute path, exports `WORKSPACE`, `UID`, `GID` and `PORT`, then runs `docker compose up --build`. The launch URL appears in the output; Ctrl+C stops the container.
- **Verify:**
  - `scripts/docker.sh examples` starts and prints `http://127.0.0.1:8000/?token=…`, and the page works.
  - `scripts/docker.sh examples --port 8100` works on 8100, which proves `LOOMVIZ_PUBLIC_PORT`.
  - `docker compose ps` shows the port bound to `127.0.0.1` only.
  - `docker compose exec loomviz touch /x` fails (read-only filesystem), and `docker compose exec loomviz id -u` matches `id -u` on the host.
  - Without `WORKSPACE`, `docker compose up` stops with the "set WORKSPACE" message.
- **Commit:** `docker: compose file and scripts/docker.sh`.

### M3.4 Behaviour on bind mounts
- **Build:** fixes for whatever this step finds, plus notes in the README. Each check runs on a scratch git repository mounted into the container:
  - **saving:** the file on the host is updated, owned by the user, and leaves no `.loomviz-tmp-*` files behind;
  - **live reload:** an edit on the host and a `git checkout` on the host reach the page; if they don't arrive, polling is needed;
  - **git status in the container:** the branch and the changed-file count match `git status` on the host, including when the host user and the container user differ (`safe.directory`);
  - **images and templates:** a harness with an image in `loom/` and a custom template renders, and the document view works;
  - **rendering timeouts:** a timed-out worker is reaped (no zombie processes, thanks to `init`).
- **Verify:** each check above, on macOS. Linux too, if a machine or VM is available (Q8). Results recorded in the PLAN's M3 result note.
- **Commit:** `docker: bind-mount fixes` (if any fixes are needed) and `docs: Docker notes`.

### M3.5 Automated Docker smoke test
- **Build:** `scripts/docker-smoke.sh`:
  1. builds the image;
  2. copies `examples/` to a temp git repository, starts the container on it with a fixed token and a random port, and waits for the healthcheck;
  3. checks: `/api/session` with the token returns 200 and without it 401; a foreign Host header gets 403; `/api/git/status` reports `repository: true`; a file written through the API exists on the host, owned by the current user; editing a file on the host produces a `files` event on `/ws/events` (a few lines of Python with `websockets`, run with `uv run --project backend`); `node scripts/ui-smoke.mjs` passes against the container;
  4. stops the container and removes the temp folder, even on failure.
- **Verify:** `scripts/docker-smoke.sh` prints `PASS` for each check and exits 0; breaking something on purpose (e.g. dropping `LOOMVIZ_PUBLIC_PORT`) makes it fail.
- **Commit:** `docker: smoke test`.

### M3.7 LAN access (SPEC FR-35, D19)
- **Build:**
  - **Back-end settings:**
    - `LOOMVIZ_ALLOWED_HOSTS` (comma-separated names or IPs): accepted in the Host/Origin checks next to the loopback names, with the browser port;
    - `LOOMVIZ_TLS_CERT` / `LOOMVIZ_TLS_KEY`: serve HTTPS (uvicorn's TLS); Origins then use `https://`;
    - the launch URLs are printed for every allowed host.
  - **CLI:**
    - `loomviz <folder> --lan`: listens on `0.0.0.0`, and adds the machine's host name, FQDN, `<name>.local` and non-loopback IP addresses to the allowed hosts;
    - `--allow-host NAME` (repeatable), plus `--tls-cert` / `--tls-key`;
    - `--lan` without TLS prints a warning that the token travels unencrypted.
  - **Docker:**
    - compose's port binding becomes `${BIND_ADDRESS:-127.0.0.1}`;
    - `compose.tls.yaml` mounts a certificate and key read-only and sets the TLS variables;
    - `scripts/docker.sh --lan [--allow-host NAME] [--tls CERT KEY]` sets `BIND_ADDRESS=0.0.0.0` and fills `LOOMVIZ_ALLOWED_HOSTS` with the *host's* names and IPs, which the container can't see itself.
  - **`scripts/dev.sh`** passes `--lan` and the TLS options through.
  - **Docs:**
    - Docker publishes ports past host firewalls such as ufw;
    - `mkcert` is an easy way to get a certificate that browsers trust;
    - an SSH tunnel remains the alternative to LAN mode.
- **Verify:**
  - `uv run pytest`: allowed hosts and Origins (http and https), LAN host detection, TLS settings (both or neither), the plain-HTTP warning, and launch URLs.
  - Natively on the Mac: `loomviz examples --lan` is reachable at the Mac's LAN IP, a made-up Host still gets 403, and with a self-signed certificate it serves HTTPS.
  - `scripts/docker-smoke.sh --native --lan [--tls]` passes; the same flags on the Linux machine.
- **Commit:** `backend: opt-in LAN access with optional TLS` and `docker: LAN and TLS options`.

### M3.6 Wrap-up
- **Build:** README gets a "Run in Docker" section (one command, `.env`, ports, polling, mount the repository root, macOS/Linux notes); CLAUDE.md commands get `scripts/docker.sh` and `scripts/docker-smoke.sh`; SPEC §12 is checked off; the PLAN gets an M3 result note.
- **Verify:** from a fresh clone, `scripts/docker-smoke.sh` passes, and `scripts/docker.sh examples` gives a working app.
- **Commit:** `docs: M3 wrap-up`. Tag `v0.1.0` (SPEC §12 complete).

**M3 status (2026-10-10):** written without a Docker host (Q8). Done and checked as far as possible here:
- **M3.1** fully tested (unit tests, plus a native run behind a simulated port mapping);
- **M3.2** the image's pnpm and uv install steps run natively from a clean export, and the result, started with the image's environment, passes `scripts/ui-smoke.mjs`;
- **M3.3** `compose.yaml` validated with the `docker compose` v2.40 binary (no daemon) in all configurations; `scripts/docker.sh` exercised against a stand-in `docker`; shellcheck and hadolint clean;
- **M3.4** folded into the smoke test;
- **M3.5** `scripts/docker-smoke.sh --native` passes every non-container check, UI included;
- **not yet run anywhere:** the Docker build itself, the container-only checks, and bind-mount behaviour on Linux.

**Linux test (to do on the separate machine):**
1. `git clone …; cd LoomViz; scripts/docker-smoke.sh` and report its output. The first build takes a few minutes.
2. If the live-reload check fails, run `scripts/docker-smoke.sh --poll`; if that passes, make polling the default, or document it.
3. `scripts/docker.sh ~/some-harness-repo`, open the URL, and try the M2 features by hand, including a `git pull` or `git checkout` on the host while LoomViz is open.
4. If the machine has SELinux enforcing: `scripts/docker-smoke.sh --selinux`.
Fixes from that run go in as `docker: …` commits. When the smoke test passes, tag `v0.1.0`.

**M3 exit criteria:**
- SPEC §12 holds in Docker on macOS (and Linux if available).
- `scripts/docker-smoke.sh` and all native tests pass.
- Files written in Docker belong to the user, and the app is reachable only on `127.0.0.1`.

## 6. Later milestones (outline)

- **M4, forms:** JSON Schema reconnaissance (old M0.7), then forms with splice-based edits (D7).
- **M5, v1.0:** export, published multi-arch image (amd64 + arm64, GitHub Container Registry), CI (including the M3 Docker smoke test), docs.

## 7. Questions (all answered)

| # | Question | Answer |
|---|---|---|
| Q1 | Which `.yml` files count as harnesses? | Only those in `loom/` (D13). |
| Q2 | Images referenced by relative path | Supported: images resolve relative to the file, sandboxed to `loom/`, inlined into the SVG (D14). |
| Q3 | WireViz version and examples | Latest PyPI release (0.4.1); examples from upstream. |
| Q4 | Test repository for the git spike | No longer needed (D16). |
| Q5 | Repository workflow | Commit straight to `main`, one commit per step. CI waits for the GitHub repository. |
| Q6 | Clone a repo, or open a local folder? | Open a local folder, served by the back-end; git in the user's own tools (D16). |
| Q7 | Which Docker runtime on the Mac? | None for now: Docker is prepared for Linux and tested there (Q8). macOS Docker (Docker Desktop, OrbStack, colima) can be checked later with the same scripts. |
| Q8 | Is a Linux machine available for testing? | Yes, a separate machine; the user runs the M3 checks there later. M3 is written but not tested here; CI in M5 runs `scripts/docker-smoke.sh` on Ubuntu too. |
| Q9 | Build the image locally only, or also publish it? | Local builds in M3 (`docker compose up --build`); publishing waits for M5, together with CI and multi-arch builds. |

## 8. Decision log

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
| D18 | **In Docker, Host/Origin checks use the host-side port** (`LOOMVIZ_PUBLIC_PORT`); the server listens on `0.0.0.0:8000` inside the container, and compose publishes it on `127.0.0.1` only. Git in the image treats `/workspace` as a safe directory. | The browser addresses the host port, which can differ from the container's; without it every request would be rejected. Marking `/workspace` safe is fine because LoomViz only reads git (D16). |
| D19 | **LAN access is opt-in (`--lan`), token-protected, HTTPS optional.** Allowed host names are explicit (detected plus `--allow-host`), so the Host check keeps blocking DNS rebinding. Without a certificate LoomViz serves plain HTTP and warns. | The user wants to open LoomViz from other machines on their network. Forcing HTTPS would require a certificate before LAN mode works at all; making it optional keeps setup simple on a trusted home network, while the warning and docs make the trade-off visible. |
