# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LoomViz is a web front-end for [WireViz](https://github.com/wireviz/WireViz) (wiring harness diagrams from YAML). The repository currently holds only the design documents; no code exists yet. Work starts at milestone M0 (feasibility spike).

- [SPEC.md](SPEC.md): **what** LoomViz does. Requirements are numbered FR-1 to FR-29 and tagged with a release ("v0.1" or "later").
- [PLAN.md](PLAN.md): **how**, **in what order** and **why**. It currently details only M0 and M1, step by step (what gets built, how to verify it, what gets committed), plus the decision log (D1–D12). Later milestones get planned after M1; the earlier M0–M7 outline is in commit `8eb109b`.

Read both before implementing anything. Work one PLAN step at a time: build, run its Verify check, then make the one commit it names, straight to `main`. When a change alters scope or a decision, update both files and keep their FR and D numbers consistent.

## Commands

- Whole app, development mode: `scripts/dev.sh [folder]` (builds the front-end, serves everything on 127.0.0.1:8000; default folder `examples/`).
- Back-end (`backend/`, uv, Python 3.12): `uv run loomviz --dev-workspace ../examples`; `uv run pytest` (single test: `uv run pytest tests/test_render.py::test_renders_demo`); `uv run ruff check . && uv run ruff format --check .`; `uv run mypy loomviz`.
- Front-end (`frontend/`, pnpm): `pnpm dev` (Vite on :5173, proxies `/api` to a back-end on :8000; open `http://localhost:5173/?token=<token the back-end printed>`); `pnpm test` (Vitest; single file: `pnpm vitest run tests/token.test.ts`); `pnpm lint` (ESLint + Prettier check); `pnpm build`. TypeScript is pinned to 6.x because typescript-eslint doesn't support TS 7 yet.
- Spike (`spike/`): `uv run pytest`, `uv run python bench.py`; `spike/roundtrip-ts`: `pnpm test`.
- Planned, not built yet: Docker (`docker compose up`), test git servers (`testing/git-servers/`).

## Architecture in brief

One Docker container: a FastAPI back-end (Python 3.12) that imports the `wireviz` library, serves a React + TypeScript front-end (Monaco editor, SVG preview, xterm.js terminal), and runs git through the `git` CLI. A session is: clone a repo with a git token → edit → commit/push to the cloned branch → "End session" wipes everything and exits the process, which stops the container.

Invariants that span many files and are easy to break:

- **Stateless container.** Read-only root filesystem, no volumes; all writable paths are tmpfs (`/workspace` for the working tree, `/run/loomviz` for credentials and git config, `/tmp`, `$HOME`). Never write anywhere else, and never add a volume.
- **Credentials never touch the repo.** Author identity and `credential.helper` live in `GIT_CONFIG_GLOBAL=/run/loomviz/gitconfig`; the helper reads `/run/loomviz/credentials`. Nothing goes in `.git/config` or the remote URL. Git output is scrubbed of the token before it reaches logs or the browser. Logs persist after the container stops, so never log credentials, file contents or repo URLs.
- **Git commands started by the back-end** always pass `-c core.hooksPath=/dev/null -c protocol.allow=never -c protocol.https.allow=always`, run with `GIT_TERMINAL_PROMPT=0`, and never fetch submodules. The terminal PTY gets the same `GIT_CONFIG_GLOBAL` environment so git works there without setup.
- **Two different tokens.** The *launch token* authenticates the browser to LoomViz (required on every HTTP/WS request, together with Origin/Host checks). The *git token* authenticates to the git host. Don't conflate them.
- **Dev mode** (`--dev-workspace <dir>`) starts with a session already open on a local folder: no clone, no credentials, no deletion on exit. All other code paths must stay identical to a real session; the Docker image never uses it.
- **Work state** is split: the back-end reports uncommitted/unpushed (and pushes updates over `WS /ws/session`); the browser adds "unsaved" from its editor buffers. End-session checks both.
- **Rendering** runs wireviz in a process pool with a timeout and an in-memory cache keyed by YAML hash + WireViz version. Renders use the editor buffer, not the saved file, and errors must never blank the last good diagram. Images referenced by relative path resolve against the edited file's `path`, stay inside `loom/`, and are inlined as data URIs; the front-end shows the SVG as an `<img>` (never injected into the DOM).
- **File access** goes through one path-sandboxing function rooted at `<working tree>/loom/` (harness files live only there; D13), with atomic writes and ETag/If-Match conflict detection. The terminal and git still operate on the whole repository.
- **YAML editing (M5 forms)** happens in the browser with the `yaml` npm package, parsed with `{ merge: true }` (WireViz files use repeated `<<` merge keys), and is applied as text splices at node ranges. Never re-serialise a whole document (`toString()`, ruamel `dump`): both rewrite WireViz's nested connection-list layout. The back-end never writes YAML through ruamel, and can't rely on ruamel to load every file (it rejects repeated `<<` keys); wireviz itself parses with PyYAML. Evidence: `spike/README.md`.

License: GPL-3.0 (WireViz is GPL-3.0 and is imported as a library).
