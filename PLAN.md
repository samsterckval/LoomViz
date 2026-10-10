# PLAN: LoomViz

Status: v0.5 (2026-10-10), matching [SPEC.md](SPEC.md) v0.5. SPEC says **what** LoomViz does; this file says **how**, **in what order**, and **why**. When a decision changes scope, update both.

## 1. Approach

Build bottom-up and keep every milestone runnable.

1. **M0, spike:** prove the risky parts in throwaway scripts: WireViz as a library, render speed, comment-preserving YAML edits, and clone/push with a git token inside a locked-down, stateless container.
2. **M1–M2, editor core:** render service, file API, editor and preview, built against a local folder in a development mode so we don't need git for every test run.
3. **M3, project session:** wrap the editor in the real flow: open repository → edit → commit/push → end session, in the stateless container.
4. **M4, terminal:** completes v0.1.
5. **After v0.1:** forms (M5), git extras (M6), polish and distribution (M7).

| Milestone | Delivers | Release |
|---|---|---|
| M0 | Feasibility spike | v0.1 |
| M1 | Render service + minimal page | v0.1 |
| M2 | Editor and file browser | v0.1 |
| M3 | Project session and save-to-remote | v0.1 |
| M4 | Terminal | v0.1 (tag `v0.1.0`) |
| M5 | Forms | later |
| M6 | SSH keys, new branches, pull requests | later |
| M7 | Export, published image, docs | v1.0 |

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **Explicit save** to the working tree (Ctrl/Cmd+S). The durable save is commit + push. Rendering always uses the editor content, saved or not. | Keeps commits meaningful; preview stays live without saving. |
| D2 | **React** for the front-end. | Fastest start: Monaco, xterm.js and react-jsonschema-form all have mature React bindings. |
| D3 | **Forms cover a core subset**: metadata, connectors, cables, simple connections, additional BOM items. Everything else stays editable in YAML and is preserved. | Full coverage of WireViz is a moving target; YAML is the escape hatch. |
| D4 | **JSON Schema**: use an upstream one if it exists, otherwise generate it from WireViz's dataclasses plus a hand-written override file. | Tracks upstream changes with little manual work. |
| D5 | **Stateless Docker, one command.** No volumes, read-only root filesystem, tmpfs for everything writable. | Easy to run anywhere; nothing to clean up or leak; the git remote is the storage. |
| D6 | **Name LoomViz, license GPL-3.0.** | WireViz is GPL-3.0 and we import it; fully open source anyway. |
| D7 | **Form edits happen in the browser** on the editor buffer, with the `yaml` npm package's Document API. ruamel.yaml stays on the back-end for validation and tests. | The editor buffer is the in-flight state; one place for edits avoids two YAML libraries fighting over formatting. M0 confirms the library round-trips cleanly. |
| D8 | **v0.1 credentials: HTTPS username + git token**, or none for public repos. SSH keys in M6. No OAuth login. | Easiest: one form field and a small credential helper; no SSH agent, key handling or host-key checks. Works on all major hosts, and the same token enables PR APIs later. OAuth needs a registered app per host and a client secret a self-hosted container can't keep. |
| D9 | **No pull requests in v0.1.** M6 adds GitHub and GitLab via API, a link elsewhere. | Keep v0.1 to the core loop. |
| D10 | **v0.1 pushes to the cloned branch.** M6 adds "push to new branch". | Simplest flow; the terminal covers other branches meanwhile. |
| D11 | **Unsaved editor content in `sessionStorage`.** | Survives a reload, disappears with the tab, so it fits "nothing persists". Never holds credentials. |

## 3. Key implementation choices

These cut across milestones; follow them from the first line of code.

**Development mode.** `loomviz --dev-workspace <dir>` starts with a session already open on a local folder: no clone, no credentials, and ending the session doesn't delete anything. It exists for development and tests only; the Docker image never uses it. All other code paths are the same as in a real session.

**Launch token.** Generated at startup (or taken from `LOOMVIZ_TOKEN`), printed as `http://127.0.0.1:<port>/?token=…`. The front-end moves it from the URL into `sessionStorage` and removes it from the address bar. It travels as an `Authorization: Bearer` header on HTTP and as a query parameter on WebSocket connects. Middleware also checks `Host` and `Origin`, because any web page the user visits can reach `127.0.0.1`.

**Binding.** Outside Docker, the server refuses non-localhost addresses unless `LOOMVIZ_ALLOW_REMOTE=1`. The image sets this because it must listen on `0.0.0.0` inside the container; compose publishes the port on `127.0.0.1` only.

**Git configuration and credentials.** Nothing goes into the repository's `.git/config`:
- `GIT_CONFIG_GLOBAL=/run/loomviz/gitconfig` (tmpfs) holds the author identity and `credential.helper=/usr/local/bin/loomviz-credential`; `GIT_CONFIG_NOSYSTEM=1`. Both the back-end and the terminal use this environment, so git in the terminal works with no extra setup.
- The credential helper reads the username and token from `/run/loomviz/credentials` (mode 0600, tmpfs).
- Git commands started by LoomViz also pass `-c core.hooksPath=/dev/null -c protocol.allow=never -c protocol.https.allow=always`, run with `GIT_TERMINAL_PROMPT=0`, and never use `--recurse-submodules`.
- Git output is scrubbed of the token before it reaches logs or the browser.

**Work state.** The back-end computes "uncommitted" (`git status --porcelain`) and "unpushed" (ahead count against the upstream), and pushes updates over `WS /ws/session` after every save, commit, push, pull and detected file change. The browser adds "unsaved" from its own editor buffers.

**Rendering.** wireviz runs in a small process pool with a per-render timeout, so a hung Graphviz call can be killed without affecting the server. Results are cached in an in-memory LRU keyed by SHA-256 of the YAML plus the WireViz version.

**Files.** All paths go through one sandboxing function (no `..`, no absolute paths, no symlinks escaping the working tree). Writes are atomic (temp file + rename) and use `ETag`/`If-Match` to detect conflicts with changes made in the terminal.

**End of session.** Order: browser checks unsaved buffers → `DELETE /api/session` checks uncommitted/unpushed → wipe credentials file and gitconfig → kill the PTY → delete the working tree → exit the process. Exiting stops the container (`restart: "no"`).

## 4. Repository layout (target)

```
LoomViz/
  SPEC.md  PLAN.md  README.md  LICENSE
  Dockerfile                  # multi-stage: Node builds the front-end; Python runtime with Graphviz, git, bash
  compose.yaml                # the one-command entry point; stateless
  compose.dev.yaml            # dev override: source mounts, reload, Vite dev server
  backend/
    pyproject.toml            # uv-managed; wireviz pinned
    loomviz/
      __main__.py             # CLI: `loomviz` or `loomviz --dev-workspace <dir>`
      app.py                  # app factory, static front-end, token + Origin/Host middleware
      config.py               # port, token, paths, limits
      session/
        manager.py            # state machine: none -> cloning -> open -> ending
        credentials.py        # gitconfig + credential file on tmpfs, wipe
        git.py                # clone/status/diff/commit/pull/push, error mapping, output scrubbing
        providers.py          # M6: PR APIs and links
      bin/loomviz-credential  # git credential helper script
      files.py                # file API, path sandboxing, atomic writes
      render.py               # wireviz wrapper, process pool, cache
      terminal.py             # PTY WebSocket
      watch.py                # file-change detection
      schema/                 # M5: JSON Schema generation + overrides
    tests/
  frontend/
    package.json              # pnpm, Vite, React, TypeScript
    src/
      api/                    # typed client for /api and /ws
      session/                # open-project form, header with work state, end-session flow
      files/                  # file tree
      editor/                 # Monaco wrapper
      preview/                # SVG viewer, zoom/pan
      changes/                # changes panel, diffs, commit/push
      terminal/               # xterm.js panel
      forms/                  # M5
    tests/
  testing/git-servers/        # CI: HTTP git server with basic auth (SSH server added in M6)
  examples/                   # sample harnesses: small / medium / large
  spike/                      # M0 scripts and results
```

## 5. Milestones

Each milestone ends in a demo-able state with its exit criteria met. FR numbers refer to SPEC §8.

### M0: Feasibility spike (no UI)

Rendering and YAML:
- [ ] Pin the latest WireViz release; record WireViz, Graphviz and Python versions in `spike/README.md`.
- [ ] Script: YAML string in, SVG out through the wireviz Python API. Note the entry point and whether it needs temp files or an output directory.
- [ ] Check whether wireviz keeps module-level state between calls (decides whether renders can reuse a worker process).
- [ ] Collect sample harnesses in `examples/`: small (~3 connectors), medium (~20), large (~60+).
- [ ] Benchmark cold and warm renders per size, parse vs Graphviz time, locally and in the container.
- [ ] Round-trip tests with ruamel.yaml and with the `yaml` npm package: changing one value changes only that line and keeps comments and order (confirms D7).
- [ ] Look for an upstream JSON Schema, or prototype generating one from the dataclasses (confirms D4).

Stateless container and git:
- [ ] Minimal image (`python:3.12-slim` + Graphviz, fonts, git), run read-only with tmpfs mounts as a non-root user. Confirm wireviz and git work (watch for tools writing to `$HOME` or `/tmp`).
- [ ] Clone and push a private repo using the gitconfig + credential helper set-up from §3. Confirm the token is absent from `.git/config`, the remote URL and process listings.
- [ ] Stop the container and inspect it (`docker diff`, `docker export`, `docker inspect`, `docker logs`): no working tree, no token.
- [ ] Add `LICENSE` (GPL-3.0).

Exit criteria: `spike/README.md` holds the benchmark table and each check's result; D4 and D7 confirmed; blockers raised with a proposed workaround.

### M1: Render service + minimal page

- [ ] Back-end skeleton: uv project, app factory, CLI with `--dev-workspace`.
- [ ] Launch token, Origin/Host middleware and binding rules (§3), on every endpoint from day one.
- [ ] `POST /api/render` with process pool, timeout, cache, and error-to-line mapping (FR-11 to FR-14).
- [ ] File API: list, read, write, rename, delete with sandboxing, atomic writes and ETags.
- [ ] Front-end skeleton (Vite + React + TypeScript): textarea + SVG panel, token handling.
- [ ] Debounced render with stale-request cancelling (`AbortController` + request id); last good SVG stays on error.
- [ ] First `Dockerfile` and `compose.dev.yaml`.
- [ ] Tests: render success/error, cache, path sandboxing, ETag conflict, token and Origin rejection.

Exit criteria: in dev mode, typing YAML updates the diagram; bad YAML shows an error and keeps the last diagram.

### M2: Editor and file browser

- [ ] Monaco + `monaco-yaml`, bundled locally; render errors as editor markers (FR-10).
- [ ] File tree with create, rename, delete (FR-7).
- [ ] Explicit save, dirty indicators, unsaved content in `sessionStorage` (FR-8).
- [ ] Preview zoom, pan, fit-to-view (FR-15).
- [ ] Layout from SPEC §7: file tree, editor, preview, resizable.
- [ ] Vitest tests for debounce/cancel and save flow.

Exit criteria: in dev mode, open, edit, save, rename and delete example files from the UI.

### M3: Project session and save-to-remote

Back-end:
- [ ] Session state machine and `GET/POST/DELETE /api/session` (FR-1 to FR-5, FR-21).
- [ ] Clone with progress streamed over `WS /ws/session`; URL validation (`https://` only); optional shallow clone; clear errors (FR-2).
- [ ] Credentials and gitconfig on tmpfs per §3 (FR-4).
- [ ] Git endpoints: status, diff, commit, pull (rebase), push to the cloned branch, typed push rejections (FR-17, FR-18).
- [ ] Work-state updates over the WebSocket (FR-16).
- [ ] End-session sequence from §3 (FR-21).

Front-end:
- [ ] Open-project form with token hints; clone progress and errors (FR-1, FR-2).
- [ ] Session resume on reload (FR-5).
- [ ] Header with branch and work state (FR-16).
- [ ] Changes panel: file list, Monaco diff view, commit, push, "pull and retry" (FR-17, FR-18).
- [ ] End-session dialog (FR-21) and `beforeunload` warning (FR-22).

Docker:
- [ ] Stateless `compose.yaml` (see §6).

Tests:
- [ ] Git flow against `testing/git-servers/` in CI: clone, commit, push, rejected push, pull and retry, bad credentials, read-only token.
- [ ] Secret-leak test: after a session, search logs, `.git/config`, process environments and `docker diff` for the token.
- [ ] Playwright end-to-end: open repo from the test server → edit → commit → push → end session.
- [ ] Manual check against real GitHub and GitLab.

Exit criteria: with `docker compose up`, open a private repo with a token, edit, commit, push, end the session, and the M0 inspection finds nothing.

### M4: Terminal (completes v0.1)

- [ ] `WS /ws/terminal`: bash in a PTY via `ptyprocess`, working tree as cwd, session git environment from §3 (FR-23, FR-24).
- [ ] Resize, clean teardown on disconnect, reconnect notice; xterm.js bottom panel.
- [ ] File-change detection with `watchfiles` (polling fallback), feeding the file tree, open editors and work state (FR-9).
- [ ] Image includes bash, git, less and a small editor (nano).

Exit criteria: SPEC §12 Definition of Done passes on macOS and Linux. Tag `v0.1.0`.

### M5: Forms

- [ ] Final JSON Schema (D4), served at `GET /api/schema`; also used for Monaco validation.
- [ ] "Form" tab next to the YAML editor, for the D3 subset (FR-25).
- [ ] Two-way sync per D7; read-only while YAML is invalid (FR-26).
- [ ] Edits touch only the targeted node; unknown keys and comments survive (FR-28).
- [ ] Custom widgets for pin lists, colour codes and the `connections` syntax.
- [ ] Form edits go through the editor's undo stack.
- [ ] Golden-file tests over every file in `examples/`.

Exit criteria: build a small harness from an empty file with forms only; it renders, and untouched sections show no diff.

### M6: SSH keys, new branches, pull requests

- [ ] Spike first: SSH key in an in-container `ssh-agent`, loaded via stdin (with and without passphrase), in the read-only container; inspection finds no key.
- [ ] SSH auth: `openssh-client` in the image, agent socket and `known_hosts` in `/run/loomviz`, `StrictHostKeyChecking=yes`, bundled host keys for GitHub/GitLab/Bitbucket, fingerprint confirmation otherwise; `ssh://` and scp-style URLs (FR-6).
- [ ] Push to a new branch (FR-19).
- [ ] Pull requests via GitHub and GitLab APIs, link fallback (FR-20).
- [ ] Tests: SSH server in `testing/git-servers/`; provider APIs with mocked HTTP (`respx`); manual checks on GitHub and GitLab.

Exit criteria: open a repo with an SSH key, push to a new branch, and open a pull request on GitHub and GitLab from the UI; nothing remains after ending the session.

### M7: Polish and distribution (v1.0)

- [ ] Export SVG, PNG, BOM (FR-29).
- [ ] Multi-arch image (amd64 + arm64) published to GitHub Container Registry from CI on each tag; `compose.yaml` pulls it.
- [ ] README: one-command quick start first, then the security model (what is kept where, the swap caveat, Ctrl+C skips the unpushed-work check), supported WireViz versions, development setup.
- [ ] More pull request hosts (Bitbucket, Gitea/Forgejo) if users ask.

Exit criteria: on a clean machine with only Docker, downloading `compose.yaml` and running `docker compose up` gives the full flow.

## 6. Docker

- **Image:** stage 1 (Node) builds the front-end; stage 2 (`python:3.12-slim`) installs Graphviz, fonts, git, bash, less and nano via apt, the back-end via uv, and the built front-end served by FastAPI. One container, one port, non-root user. `openssh-client` joins in M6.
- **compose.yaml:**
  - `ports: ["127.0.0.1:${PORT:-8000}:8000"]`
  - `read_only: true`, no volumes
  - tmpfs: `/workspace` (default 1 GB), `/run/loomviz`, `/tmp`, home directory
  - `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `restart: "no"`
  - environment: `LOOMVIZ_ALLOW_REMOTE=1` (inside the container only), optional `LOOMVIZ_TOKEN`
- **Logs:** Docker keeps logs after the container stops, so they contain only the launch URL and generic events: never credentials, file contents or (at the default level) repository URLs.
- **Stopping:** "End session" exits the process and the container stops. Ctrl+C and `docker compose down` also stop it but skip the unpushed-work check. A stopped container holds no session data because tmpfs is cleared and the root filesystem is read-only; `docker compose down` removes it entirely.
- **Development:** `docker compose -f compose.yaml -f compose.dev.yaml up` runs uvicorn with reload and the Vite dev server. Without Docker: `uv run loomviz --dev-workspace examples/` plus `pnpm dev`.

## 7. Tooling and CI

- Back-end: uv, ruff, mypy, pytest. Front-end: pnpm, ESLint, Prettier, Vitest. End-to-end: Playwright (from M3).
- GitHub Actions on every PR: lint and unit tests; start `testing/git-servers/`; build the Docker image; run the end-to-end test against it. Render benchmark from M0 as a non-blocking report.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Container stops (Ctrl+C, crash, reboot) before the user pushes | Lost work | Work state always visible; `beforeunload` warning; guided end-session flow; README warns that Ctrl+C skips the check. |
| Push rejected: remote moved on, protected `main`, read-only token | User stuck at the end of a session (likely in v0.1, which always pushes to the cloned branch) | "Pull and retry"; clear message for protected branches and missing write access; terminal to push elsewhere; users can clone a working branch; M6 adds new branch + PR. |
| Token leaks via logs, `.git/config`, process arguments, error messages | Account compromise | Credential helper + tmpfs gitconfig (§3); output scrubbing; secret-leak test in CI. |
| Malicious repository content or URL (hooks, `ext::`/`file://` transports, submodules) | Commands run in the container | Protocol allow-list, hooks disabled, no submodules for LoomViz-started git commands. |
| LoomViz reachable from other sites or machines (it offers a shell) | Remote code execution, stolen token | `127.0.0.1`-only port, launch token, Origin/Host checks from M1. |
| WireViz API is CLI-oriented or keeps global state | Slow or flaky renders | M0 finds out; per-render temp dirs in worker processes. |
| Graphviz slow on large harnesses | Laggy UI | Debounce, cancel, cache, worker processes, "rendering…" state. |
| Large repositories | Clone fails or memory pressure | Configurable tmpfs size, shallow clone, clear error. |
| Comment-preserving form edits are fragile | Noisy diffs, lost comments | D7: one editing path; golden-file tests over all examples. |
| WireViz YAML (e.g. `connections`) hard to express as JSON Schema | Forms fall short | Custom widgets; YAML remains the fallback (D3). |
| Upstream WireViz changes its format | Schema and forms drift | Pinned version; generated schema; planned upgrades. |

## 9. Next steps

1. Commit SPEC.md and PLAN.md.
2. Create the GitHub repository (for CI and the container registry) and a private test repository of WireViz files.
3. Start M0.
