# PLAN: LoomViz, M0 and M1

Status: 2026-10-10, for [SPEC.md](SPEC.md) v0.5.

**Progress:**
- Done: M0.1–M0.6 (results in `spike/README.md`) and M1.1–M1.9. A working prototype runs with `scripts/dev.sh` (see README).
- Deferred:
  - M0.7, JSON Schema: needed only for forms (M5);
  - M0.8–M0.10, locked-down container and git spike, plus M1.10, Docker image: Docker isn't installed on the development machine yet;
  - M1.11, CI: waits for the GitHub repository;
  - M1.12, wrap-up: done except the Docker parts.
- Deviations: M1.1–M1.6 landed as one back-end commit. The preview uses a `data:` URL instead of a blob URL (simpler lifecycle, same isolation). Render workers are warmed up at start-up. SPEC says **what** LoomViz does; this file says **how**, **in what order** and **why**. It covers only the first two milestones. Later milestones are planned once M1 is done; the earlier full outline (M0–M7) is in commit `8eb109b`.

All open questions are resolved; the answers are in §5.

## 1. Scope

| Milestone | Goal | Ends with |
|---|---|---|
| **M0: Feasibility spike** | Prove the risky parts in throwaway scripts before writing app code: WireViz as a library, render speed, comment-preserving YAML edits, and clone/push with a git token inside a locked-down, stateless container. | `spike/README.md` with measured results and a go/no-go per risk. |
| **M1: Render service + minimal page** | First real app code: FastAPI back-end with launch-token security, file API and render service; a minimal React page that live-renders YAML; a Docker image. Runs in development mode against a local folder (no git yet). | Typing YAML in the browser updates the diagram; bad YAML shows an error and keeps the last diagram. Works locally and in Docker. |

Out of scope here: Monaco, file tree UI, cloning from the app, git endpoints, terminal, forms (M2 and later).

## 2. Ground rules

- **Every step ends in one commit** (occasionally two, if noted) on `main`. Each commit leaves lint and tests green.
- **Commit messages:** `<area>: <what>`, e.g. `spike: render YAML via wireviz API`, `backend: add launch token middleware`. Every commit ends with the `Co-Authored-By` trailer.
- **No secrets in the repo.** Spike credentials come from environment variables or an untracked `.env`; `.gitignore` covers `.env`, `*.token` and spike output.
- **Spike code lives in `spike/`** and is never imported by app code. It stays in the repo as a record until M3, when the app covers the same ground.
- **"Verify"** is a command (or short manual check) you can run yourself. Expected output is stated.

## 3. M0: Feasibility spike

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/), Node 20+ with pnpm, Graphviz (`brew install graphviz`) for local runs.

### M0.1 Repository basics
- **Build:** `LICENSE` (GPL-3.0 full text), `.gitignore` (Python, Node, `.env`, `spike/out/`), a one-paragraph `README.md` pointing to SPEC and PLAN.
- **Verify:** `head -3 LICENSE` shows "GNU GENERAL PUBLIC LICENSE Version 3"; `git status` is clean after the commit.
- **Commit:** `repo: add GPL-3.0 license, gitignore and README stub`. (Done; CLAUDE.md went in with the docs commit.)

### M0.2 Example harnesses
- **Build:** `examples/`, laid out like a real loom repository (D13): harness files in `examples/loom/`, plus a stray `examples/.github/workflows/ci.yml` and `examples/docker-compose.yml` that the file API must ignore. In `examples/loom/`:
  - `small.yml` (~3 connectors), `medium.yml` (~20), `large.yml` (~60+), adapted from the upstream WireViz tutorial and examples (GPL-3.0, attribution in `examples/README.md`), with medium and large in a subfolder to exercise nesting;
  - `commented.yml`, with comments in many places (for the round-trip tests);
  - `broken-syntax.yml` (invalid YAML) and `broken-semantic.yml` (valid YAML, invalid WireViz, e.g. a connection to a pin that doesn't exist);
  - `with-image.yml` in a subfolder, referencing a PNG in a sibling folder by relative path (e.g. `../images/connector.png`), for D14.
- **Verify:** `uvx --from wireviz==<pinned> wireviz -f s examples/loom/small.yml` (and medium, large, commented) produces an `.svg`; both broken files fail with an error.
- **Commit:** `examples: add sample harnesses for tests and benchmarks`.

### M0.3 Render through the library
- **Build:** `spike/pyproject.toml` (uv, wireviz pinned to the latest PyPI release, ruamel.yaml, jsonschema) and `spike/render.py`: takes a YAML string and returns an SVG string through the wireviz Python API, not the CLI. Findings in `spike/README.md`:
  - which function is the entry point;
  - whether it needs an output directory or temp files;
  - how errors surface (exception types, whether line numbers are available);
  - how relative image paths resolve (relative to the working directory, an argument, or the YAML file's location?) and how they appear in the SVG output, which decides how M1.5 inlines them (D14);
  - whether module-level state leaks between calls (render A, B, A in one process and compare A's two outputs byte for byte).
- **Verify:** `uv run --project spike spike/render.py examples/loom/small.yml > spike/out/small.svg`, then open the SVG. `uv run --project spike spike/render.py --state-check` prints `state leak: no` (or documents the leak).
- **Commit:** `spike: render YAML to SVG via the wireviz API`.

### M0.4 Benchmark
- **Build:** `spike/bench.py`: for small, medium and large, measure cold (fresh process) and warm (same process) render time, split into parse and Graphviz time, 5 runs each, median reported.
- **Verify:** `uv run --project spike spike/bench.py` prints a Markdown table; it goes into `spike/README.md`. Target from SPEC §9: medium under ~1 s warm.
- **Commit:** `spike: render benchmark and results`.

### M0.5 YAML round trip, Python
- **Build:** `spike/roundtrip.py`: for each example, load with ruamel.yaml (round-trip mode), dump unchanged and compare with the original, then change one scalar (e.g. a connector's `pincount`) and diff.
- **Verify:** `uv run --project spike spike/roundtrip.py` exits 0. For every file: the unchanged dump is identical, or the differences are listed; the one-value edit changes exactly one line.
- **Commit:** `spike: ruamel.yaml round-trip check`.

### M0.6 YAML round trip, TypeScript (confirms D7)
- **Build:** `spike/roundtrip-ts/` (package.json, `yaml` npm package, tsx): the same two checks with the `yaml` Document API (`parseDocument`, `setIn`, `toString`).
- **Verify:** `pnpm --dir spike/roundtrip-ts install && pnpm --dir spike/roundtrip-ts start` exits 0 with the same per-file report. If a file doesn't round-trip cleanly, the formatting differences are recorded, plus whether `toString` options fix them.
- **Commit:** `spike: yaml (npm) round-trip check`.

### M0.7 JSON Schema reconnaissance (D4, time-boxed to half a day)
- **Build:** a note in `spike/README.md` on whether upstream publishes a schema. If not, `spike/schema.py` generates a draft JSON Schema from the wireviz dataclasses and validates all examples against it.
- **Verify:** `uv run --project spike spike/schema.py` prints, per example, valid/invalid with reasons; the broken-semantic file should ideally be invalid. Gaps (e.g. the `connections` syntax) are listed.
- **Commit:** `spike: JSON Schema reconnaissance`.

### M0.8 Locked-down container
- **Build:** `spike/docker/Dockerfile` (`python:3.12-slim`, apt: graphviz, fonts-dejavu, git; non-root user; spike scripts installed with uv) and `spike/docker/compose.yaml` with the target hardening: `read_only: true`, tmpfs for `/workspace`, `/run/loomviz`, `/tmp` and `$HOME`, `cap_drop: [ALL]`, `no-new-privileges`, no volumes except the examples mounted read-only (spike only).
- **Verify:**
  - `docker compose -f spike/docker/compose.yaml run --rm spike python render.py /examples/loom/medium.yml | head -c 200` shows `<svg` (wireviz and Graphviz work on a read-only filesystem);
  - `docker compose -f spike/docker/compose.yaml run --rm spike python bench.py` gives a second benchmark table, added to `spike/README.md`;
  - `docker compose -f spike/docker/compose.yaml run --rm spike id` shows a non-root uid.
- **Commit:** `spike: render inside a read-only, tmpfs-only container`.

### M0.9 Clone and push with a git token
- **Build:**
  - `spike/docker/loomviz-credential`, a git credential helper that answers `get` from `/run/loomviz/credentials`;
  - `spike/docker/git-spike.sh`, which:
    - writes `/run/loomviz/gitconfig` (author identity, `credential.helper`) and the 0600 credentials file from `SPIKE_GIT_USER`/`SPIKE_GIT_TOKEN`;
    - sets `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`;
    - clones `SPIKE_GIT_URL` into `/workspace` with `-c core.hooksPath=/dev/null -c protocol.allow=never -c protocol.https.allow=always`;
    - edits a file, commits, pushes;
    - then runs leak checks: the token is absent from `.git/config`, `git remote -v`, the command line of every process (`/proc/*/cmdline`) and the script's own output.
  - Test target: the empty private repository you create, with a token limited to that repo. Because it starts empty, the script checks whether the clone has any commits and, if not, creates the first commit on `main` and pushes with `-u origin main`. A second run then exercises the normal path (existing branch, fast-forward push).
- **Verify:** `SPIKE_GIT_URL=… SPIKE_GIT_USER=… SPIKE_GIT_TOKEN=… docker compose -f spike/docker/compose.yaml run --name loomviz-spike spike ./git-spike.sh` prints `PASS` for clone, commit, push and each leak check; the commit appears on the remote. Run it twice (`docker rm loomviz-spike` in between): the first run initialises the empty repo, the second pushes on top.
- **Commit:** `spike: clone and push with credential helper on tmpfs`.

### M0.10 Leftover inspection
- **Build:** `spike/docker/inspect.sh <container> <token>`: after the M0.9 container stops, it runs `docker diff`, `docker export | tar -t`, a search of the exported filesystem, `docker inspect` (environment, mounts) and `docker logs`, all searched for the token and the clone.
- **Verify:** `./spike/docker/inspect.sh loomviz-spike "$SPIKE_GIT_TOKEN"` prints `PASS: no trace` for each check, then `docker rm loomviz-spike`. Note: the token was passed in as an environment variable for the spike, so `docker inspect` *will* show it. That is expected here, and is why the real app takes the token through the UI (M3). The script reports this check separately.
- **Commit:** `spike: post-stop inspection for leftover data`.

### M0.11 Results and go/no-go
- **Build:** `spike/README.md` completed with one section per risk (rendering API, state leaks, performance local/Docker, round-trip Python/TS, schema, read-only container, credentials, leftovers): result, evidence (command + output excerpt), and consequence for M1. PLAN.md's decision log updated (D4, D7 confirmed or revised); blockers listed with a proposed workaround.
- **Verify:** you review `spike/README.md`; every M0 step above has a result.
- **Commit:** `docs: M0 results` (spike README, PLAN).

**M0 exit criteria:** every check above has a recorded result; D4 and D7 confirmed or revised; no unresolved blocker for M1.

## 4. M1: Render service + minimal page

Layout after M1:

```
backend/   pyproject.toml, loomviz/{__main__,app,config,security,files,render}.py, tests/
frontend/  Vite + React + TypeScript, src/{api,preview}/, tests/
Dockerfile, compose.dev.yaml
```

### M1.1 Back-end skeleton and tooling
- **Build:** `backend/pyproject.toml` (uv; fastapi, uvicorn, wireviz pinned to the M0 version, ruamel.yaml; dev: pytest, httpx, ruff, mypy), package `loomviz` with an app factory and CLI `loomviz --dev-workspace <dir> [--port 8000]`. Dev mode means a session is already open on that folder. `GET /api/session` returns `{state: "open", repo: "<folder name>", branch: null}` in dev mode and `{state: "none"}` otherwise.
- **Verify:** `cd backend && uv run ruff check . && uv run mypy loomviz && uv run pytest` all pass (one smoke test calls `/api/session`). `uv run loomviz --dev-workspace ../examples` starts and logs its URL.
- **Commit:** `backend: FastAPI skeleton, CLI and tooling`.

### M1.2 Launch token, Origin/Host checks, binding rules
- **Build:** `security.py`:
  - **launch token:** random 32-byte token, or `LOOMVIZ_TOKEN`; startup prints `http://127.0.0.1:<port>/?token=…`; `Authorization: Bearer` on HTTP and a `token` query parameter on WebSockets (no WebSocket route yet, so it's tested on a test-only route);
  - **Host check:** `127.0.0.1:<port>` or `localhost:<port>`;
  - **Origin check:** same host, or absent for non-browser clients;
  - **binding:** refuse non-loopback addresses unless `LOOMVIZ_ALLOW_REMOTE=1`.
- **Verify:** `uv run pytest tests/test_security.py` covers missing token → 401, wrong token → 401, foreign `Host` (DNS rebinding) → 403, foreign `Origin` → 403, valid request → 200, `--host 0.0.0.0` without the env var exits with an error. Manual: `curl -i localhost:8000/api/session` → 401; with `-H "Authorization: Bearer $TOKEN"` → 200.
- **Commit:** `backend: launch token, Origin/Host checks and bind rules`.

### M1.3 File API: list and read
- **Build:** `files.py` with one sandboxing function whose root is `<workspace>/loom` (D13): it resolves symlinks and rejects `..`, absolute paths and anything outside `loom/`. `GET /api/files` returns `{loom_folder_exists, files}` (recursive `.yml`/`.yaml` under `loom/`); `GET /api/files/{path}` returns content + `ETag`.
- **Verify:** `uv run pytest tests/test_files.py` covers: the listing (nested folders; `.github/` and root-level YAML outside `loom/` not listed); a workspace without `loom/` → `loom_folder_exists: false`, empty list; reading; `../README.md` (escaping `loom/` into the repo) → 400; `../../etc/passwd` → 400; absolute path → 400; symlink pointing outside `loom/` → 400; missing file → 404.
- **Commit:** `backend: file listing and reading with path sandboxing`.

### M1.4 File API: write, rename, delete
- **Build:** `PUT /api/files/{path}` (atomic: temp file in the same directory + `os.replace`; `If-Match` required for existing files, 412 on mismatch; creates new files when `If-None-Match: *`), `POST /api/files/{path}/rename`, `DELETE /api/files/{path}`. Only `.yml`/`.yaml` targets allowed. Writing the first file creates `loom/` (and any subfolders) if missing.
- **Verify:** `uv run pytest tests/test_files.py` adds: in a workspace without `loom/`, writing `loom`-relative `a.yml` creates `loom/a.yml`; write then read returns new content and a new ETag; stale `If-Match` → 412 and file unchanged; no temp files left after a write; rename onto an existing file → 409; delete then read → 404; writing `foo.txt` → 400.
- **Commit:** `backend: file write, rename and delete with ETag conflicts`.

### M1.5 Render service
- **Build:** `render.py` and `POST /api/render {yaml, path?}`. Shape:
  - wireviz runs in a `ProcessPoolExecutor` (2 workers) with a per-render timeout (default 10 s); a timed-out worker is killed and the pool is replaced;
  - each render gets its own temp directory under `/tmp`, if M0 shows wireviz needs one;
  - responses are `{svg, warnings}` or `{error, line?}` (HTTP 200 in both cases, since an invalid harness is a normal state, not a server error);
  - YAML syntax errors carry the line from the parser; WireViz errors carry a line when M0 found a way to recover one;
  - images (D14): `path` is checked by the M1.3 sandboxing function; relative image references resolve against its folder; each referenced image must also pass the sandbox (outside `loom/` → a warning and a placeholder, not an error) and is inlined into the SVG as a data URI. Without `path`, relative images resolve against `loom/` itself.
- **Verify:** `uv run pytest tests/test_render.py` covers: each valid example → body starts with `<svg`; `with-image.yml` with its `path` → the SVG contains a `data:image/png;base64,` URI and no file path; an image reference escaping `loom/` → a warning, no file content leaked; `broken-syntax.yml` → `error` with the correct `line`; `broken-semantic.yml` → `error`; a deliberately slow render (test hook) → timeout error, and the next render still succeeds. Manual: `curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$(jq -Rs '{yaml: .}' ../examples/loom/small.yml)" localhost:8000/api/render | jq -r .svg > /tmp/small.svg`.
- **Commit:** `backend: render service with worker pool and timeout`.

### M1.6 Render cache
- **Build:** an in-memory LRU (default 128 entries) keyed by SHA-256 of `yaml` + `path` + WireViz version + the size and modification time of each referenced image, in front of the pool.
- **Verify:** `uv run pytest tests/test_render.py` adds: the same YAML twice → the second call doesn't reach the pool (counter or mock); one changed character → a miss; a different WireViz version string → a miss; replacing the referenced image file → a miss.
- **Commit:** `backend: render cache`.

### M1.7 Front-end skeleton
- **Build:** `frontend/` with Vite + React + TypeScript (pnpm), ESLint, Prettier and Vitest. Plus:
  - `src/api/`: a typed client that adds the bearer token;
  - token handling: read `?token=` on load, store it in `sessionStorage`, remove it from the address bar with `history.replaceState`;
  - the Vite dev server proxies `/api` and `/ws` to `127.0.0.1:8000`.
- **Verify:** `cd frontend && pnpm lint && pnpm test && pnpm build` pass. `pnpm test` includes token handling: taken from the URL, stored, URL cleaned, reused after reload.
- **Commit:** `frontend: Vite + React skeleton, API client and token handling`.

### M1.8 Live preview page
- **Build:** one page with a file picker (a plain `<select>` fed by `GET /api/files`), a textarea with the file content, and a preview panel. Behaviour:
  - debounce 400 ms; each render request gets an increasing id and an `AbortController`; responses older than the latest are dropped;
  - the last good SVG stays visible under an error banner showing the message and line;
  - the SVG is displayed as an `<img>` from a blob URL, not injected into the DOM, so any script in an SVG built from repository content can't run in the page that holds the launch token. Zoom/pan in M2 works on the image.
  - "Save" (button + Ctrl/Cmd+S) via `PUT` with `If-Match`, showing a message on 412.
- **Verify:**
  - `pnpm test` (Vitest, fake timers, mocked fetch): typing quickly sends one request; a slow first response arriving after a fast second one is ignored; an error keeps the previous SVG and shows the banner.
  - Manual, two terminals: `cd backend && uv run loomviz --dev-workspace ../examples` and `cd frontend && pnpm dev`, then open `http://localhost:5173/?token=<printed token>`. Pick `medium.yml`, change a wire colour and see the diagram update within about a second. Break the indentation: error banner with the line, old diagram stays. Fix it: the banner disappears. Open `with-image.yml`: the image shows in the diagram. Save, then check the file on disk with `git diff examples/`, and revert it.
- **Commit:** `frontend: live preview with debounce, cancellation and save`.

### M1.9 Serve the built front-end from the back-end
- **Build:** FastAPI serves `frontend/dist` (path from config) at `/`, with SPA fallback; API routes take precedence. The static files themselves don't need the token (they contain no data); the API calls they make do.
- **Verify:** `cd frontend && pnpm build && cd ../backend && uv run loomviz --dev-workspace ../examples`, open the printed URL: the same page works from one port. `uv run pytest` includes a test that `/` returns `index.html` and `/api/session` without a token still returns 401.
- **Commit:** `backend: serve the built front-end`.

### M1.10 Docker image (development mode)
- **Build:**
  - multi-stage `Dockerfile`: stage 1 runs `node:20-slim` + pnpm to build the front-end; stage 2 is `python:3.12-slim` + apt graphviz, fonts-dejavu and git, the back-end installed with uv, the front-end copied in, a non-root user, `LOOMVIZ_ALLOW_REMOTE=1`, and listening on `0.0.0.0:8000`.
  - `compose.dev.yaml` for M1: mounts `./examples` at `/workspace` (dev mode only; the stateless production `compose.yaml` comes in M3), publishes `127.0.0.1:8000:8000`, and already uses `read_only: true`, tmpfs for `/tmp` and `$HOME`, `cap_drop: [ALL]` and `no-new-privileges`, so problems with the hardening show up now.
  - `scripts/smoke.sh`: waits for the server, reads the token from the logs, and posts `examples/loom/small.yml` to `/api/render`.
- **Verify:**
  - `docker compose -f compose.dev.yaml up --build`, then open the logged URL and repeat the M1.8 manual check;
  - `./scripts/smoke.sh` prints `PASS`;
  - `docker compose -f compose.dev.yaml exec app id` shows a non-root uid;
  - `curl -i http://<your LAN IP>:8000/` from another device fails, because the port is bound to localhost only.
- **Commit:** `docker: multi-stage image and dev compose file`.

### M1.11 CI (only once the project's GitHub repository exists; otherwise deferred)
- **Build:** `.github/workflows/ci.yml`: back-end ruff, mypy and pytest (with Graphviz installed); front-end lint, test and build; Docker build + `scripts/smoke.sh`.
- **Verify:** push a branch; the workflow is green. Locally, `act` is optional.
- **Commit:** `ci: lint, test, build and Docker smoke test`.

### M1.12 Wrap-up
- **Build:** CLAUDE.md commands section replaced with the real, tested commands; PLAN.md M1 steps ticked; known gaps noted for M2.
- **Verify:** follow CLAUDE.md's commands from a fresh clone; they all work.
- **Commit:** `docs: M1 wrap-up`.

**M1 exit criteria:**
- In dev mode, locally and in Docker, typing YAML updates the diagram within about a second for `medium.yml`.
- Bad YAML shows an error with its line and keeps the last diagram.
- Saving writes to disk and detects conflicting changes.
- All tests pass.
- Requests without the launch token, or from a foreign Origin/Host, are rejected.

### Added after M1: document view and selection (SPEC FR-30, FR-31)

Built now on top of the M1 prototype, since they need no git work. M2 (Monaco) will later improve the jump-to-line part.

#### M1.13 Document view (FR-30)
- **Build:**
  - The render worker builds the harness once, then produces both the SVG and, when asked (`html: true`), WireViz's HTML via its own `generate_html_output`, in a per-render temp folder. No second Graphviz run.
  - Template names are restricted to `[A-Za-z0-9_-]+`. A matching `<name>.html` inside `loom/` (next to the file, sandboxed) is used first, then WireViz's built-ins; anything else falls back to the simple template with a warning.
  - The temp path is scrubbed from the HTML.
  - Front-end: a "Diagram | Document" toggle. The document is shown in an `<iframe sandbox>` (no scripts, no same-origin) via `srcdoc`, with a Content-Security-Policy that blocks all external loads.
- **Verify:**
  - `uv run pytest tests/test_render.py`: `html: true` returns a document with the BOM table and the din-6771 frame for `demo02.yml`; a template name like `../../x` is refused with a warning; no temp path appears in the output; the cache distinguishes `html` requests.
  - `pnpm test`: the CSP is injected into the document.
  - Manual: open `demo02.yml`, switch to Document; the A3 drawing frame with title block and the BOM are shown.
- **Commit:** `render: WireViz HTML document view`.

#### M1.14 Interactive diagram: select connectors and cables (FR-31)
- **Build:**
  - The Diagram view inserts the SVG inline after sanitising it with DOMPurify (SVG profile; no scripts, event handlers, `foreignObject` or external references; `data:` images kept). This replaces the `<img>` approach of D12 (see D15).
  - Clicking a node finds its designator (from the SVG `<title>`) and looks it up in the editor text with the `yaml` package (`{ merge: true }`): where it's defined, where it's used in `connections`, and its resolved attributes.
  - The editor scrolls to and selects the definition; an info panel lists attributes and usages (each usage clickable).
- **Verify:** `pnpm test`: sanitiser tests (malicious SVG with `<script>`, `onload`, `javascript:` links and `foreignObject` comes out clean; `data:` images survive); locate tests on `demo02.yml` (X2 → line of `X2:` plus its usage; W1 → cable definition and its connection set; auto-generated ferrules → the `F.` line). Manual: click X1 and W3 in the diagram.
- **Commit:** `frontend: select connectors and cables in the diagram`.

#### M1.15 Per-wire selection (FR-31)
- **Build:** Spike first: the edges WireViz gives Graphviz carry no wire number (four identical `X1:e--W1:w` titles for W1's four wires), so the worker tags each edge with `id="wire-<cable>-<n>"` before Graphviz runs. Then clicking a wire shows its cable, wire number, colour, gauge, length and both ends, and selects its connection-set line.
- **Verify:** `uv run pytest`: every wire edge in `demo02.yml`'s SVG has a unique `wire-W<k>-<n>` id, and the rendered diagram is otherwise unchanged. `pnpm test`: a wire id resolves to the right cable, ends and colour. Manual: click the yellow wire of W1 → "W1 wire 3: YE, X1:3 SCL → X2:3 SCL".
- **Commit:** `render: wire ids` and `frontend: select individual wires`.

## 5. Resolved questions

| # | Question | Answer |
|---|---|---|
| Q1 | Which `.yml` files count as harnesses? | Only those in `loom/` (D13). |
| Q2 | Images referenced by relative path | Supported in v0.1: `POST /api/render` takes an optional `path`; images resolve relative to it, sandboxed to `loom/`, and are inlined into the SVG as data URIs (D14). |
| Q3 | WireViz version and examples | Pin the latest PyPI release (confirmed in M0.3). Examples come from the upstream WireViz tutorial and examples. |
| Q4 | Test repository for the git spike | You create an empty private repo and a token with write access to it only. The spike handles the empty repo (first commit creates `main`). A local test git server comes in M3 for CI. |
| Q5 | Repository workflow | Commit straight to `main`, one commit per step. CI (M1.11) waits until the project's GitHub repository exists. |

## 6. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **Explicit save** to the working tree (Ctrl/Cmd+S). The durable save is commit + push. Rendering always uses the editor content, saved or not. | Keeps commits meaningful; preview stays live without saving. |
| D2 | **React** for the front-end. | Fastest start: Monaco, xterm.js and react-jsonschema-form all have mature React bindings. |
| D3 | **Forms cover a core subset** (metadata, connectors, cables, simple connections, additional BOM items); everything else stays editable in YAML and is preserved. | Full WireViz coverage is a moving target; YAML is the escape hatch. |
| D4 | **JSON Schema:** upstream if it exists, else generated from WireViz's dataclasses plus hand-written overrides. *To confirm in M0.7.* | Tracks upstream changes with little manual work. |
| D5 | **Stateless Docker, one command.** No volumes, read-only root filesystem, tmpfs for everything writable. | Easy to run; nothing to clean up or leak; the git remote is the storage. |
| D6 | **LoomViz, GPL-3.0.** | WireViz is GPL-3.0 and is imported as a library. |
| D7 | **Form edits happen in the browser** on the editor buffer with the `yaml` npm package, parsed with `{ merge: true }`, and applied as **targeted text splices at node ranges**, never by re-serialising the document (`toString()`). The back-end never writes YAML through ruamel.yaml. *Confirmed in M0.6 (spike/README.md §3–4).* | Re-serialising rewrites WireViz's usual connection layout and list spacing (both libraries); ruamel can't even load files with repeated `<<` keys. Splicing keeps untouched text byte-identical. |
| D8 | **v0.1 credentials: HTTPS username + git token** (or none). SSH later; no OAuth. | Simplest to build, works on all major hosts, and enables PR APIs later. OAuth needs a client secret a self-hosted container can't keep. |
| D9 | **No pull requests in v0.1.** | Keep v0.1 to the core loop. |
| D10 | **v0.1 pushes to the cloned branch.** | Simplest flow; the terminal covers other branches. |
| D11 | **Unsaved editor content in `sessionStorage`.** | Survives a reload, gone with the tab; never holds credentials. |
| D12 | **SVG preview shown as an `<img>` (from a `data:` URL)**, never injected into the DOM (new, M1.8). | Diagrams are built from repository content; an `<img>` never runs scripts, so a malicious SVG can't reach the launch token. |
| D13 | **Harness files live in a fixed `loom/` folder** at the repository root. The file tree and file API are sandboxed to it; the terminal and git see the whole repo. If it's missing, LoomViz offers to create it. The name is fixed in v0.1. | Separates harnesses from other YAML (CI workflows, compose files) without guessing, and gives the file API a tight sandbox root. |
| D14 | **Images in the preview:** the render request carries the file's `path`; images resolve relative to it, are sandboxed to `loom/`, and are inlined into the SVG as data URIs. | The `<img>` preview (D12) can't load files by path, and inlining keeps the preview self-contained. |
| D15 | **Interactive diagram:** the Diagram view inserts the SVG inline after sanitising it with DOMPurify (replaces D12's `<img>`, which can't be clicked into). The Document view stays isolated in an `<iframe sandbox>` with a blocking CSP. | Selection (FR-31) needs DOM access to the SVG; sanitising removes everything that could run or load code, so the launch token stays out of reach. |
