# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LoomViz is a web editor for [WireViz](https://github.com/wireviz/WireViz) wiring harness diagrams. It opens a local folder (usually a git repository) and edits the harness YAML in its `loom/` subfolder, with a live diagram; git stays in the user's own tools. A working prototype exists (M1); M2 is in progress.

- [SPEC.md](SPEC.md): **what** LoomViz does. Requirements FR-1 to FR-34, tagged by release; removed ones are kept as stubs so numbers stay stable.
- [PLAN.md](PLAN.md): **how**, **in what order** and **why**: milestone table, M2 step by step (build, verify, commit), and the decision log (D1–D17; D16 is the switch to local folders).

Work one PLAN step at a time: build, run its Verify check, then make the one commit it names, straight to `main`. When a change alters scope or a decision, update SPEC and PLAN together and keep FR and D numbers consistent.

## Commands

- Whole app: `scripts/dev.sh [folder]` (builds the front-end, serves everything on 127.0.0.1:8000; default folder `examples/`).
- Back-end (`backend/`, uv, Python 3.12): `uv run loomviz ../examples`; `uv run pytest` (single test: `uv run pytest tests/test_render.py::test_renders_demo`); `uv run ruff check . && uv run ruff format --check .`; `uv run mypy loomviz`.
- Front-end (`frontend/`, pnpm): `pnpm dev` (Vite on :5173, proxies `/api` and `/ws` to a back-end on :8000; open `http://localhost:5173/?token=<token the back-end printed>`); `pnpm test` (Vitest; single file: `pnpm vitest run tests/token.test.ts`); `pnpm lint` (ESLint + Prettier check); `pnpm build`. TypeScript is pinned to 6.x because typescript-eslint doesn't support TS 7 yet.
- Spike (`spike/`): `uv run pytest`, `uv run python bench.py`; `spike/roundtrip-ts`: `pnpm test`.
- Not built yet: Docker (M3).

## Architecture in brief

A FastAPI back-end (Python 3.12, `backend/loomviz/`) is started on a folder. It serves the built React + TypeScript front-end (`frontend/`), a file API confined to `loom/`, a render service that runs the `wireviz` library in worker processes, and (M2) read-only git status and a file-change WebSocket.

Invariants that span many files and are easy to break:

- **Security baseline.** Every `/api` and `/ws` request needs the launch token (Bearer header on HTTP, `?token=` on WebSockets) and passes Host/Origin checks (`security.py`); the server binds to loopback unless `LOOMVIZ_ALLOW_REMOTE=1`. Don't add endpoints outside `/api` or `/ws` that return data.
- **File access** goes through `Workspace.resolve` in `files.py`, rooted at `<workspace>/loom/` (D13): no `..`, absolute paths, hidden files or symlinks escaping it. Writes are atomic with ETag/If-Match conflict detection. LoomViz never writes outside `loom/`.
- **Git is read-only** (D16). Never add a git command that writes (commit, checkout, pull, config, …). Git runs with `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `-c core.fsmonitor=false`, a timeout and no shell.
- **Rendering** (`render.py`) runs wireviz in a spawn-based process pool with a timeout and an LRU cache keyed by content (YAML, path, WireViz version, referenced images, html flag). It renders the editor buffer, not the saved file, and errors never blank the last good diagram. `wireviz.parse()` mutates its default `image_paths`, so always pass a fresh list. Images resolve against the edited file's folder, stay inside `loom/`, and are inlined as data URIs. WireViz template names are restricted (`check_template`) because WireViz resolves them as file paths.
- **Untrusted output.** Diagram SVG and HTML document are built from file content: the SVG goes into the page only through `sanitizeSvg` (`frontend/src/preview/sanitize.ts`), and the HTML only into an `<iframe sandbox="">` with the blocking CSP from `document.ts`.
- **Selection** (FR-31, FR-32) relies on ids the back-end adds before Graphviz runs (`wire-<cable>-<n>-a|b`, see `tag_wires`) and on node `<title>`s; the render result's `wires` map is WireViz's own resolution of each wire; `frontend/src/editor/locate.ts` maps between designators and YAML positions.
- **YAML in the front-end** is parsed with the `yaml` package and `{ merge: true }` (WireViz files use repeated `<<` merge keys). Edits LoomViz makes itself (forms, M4) are text splices at node ranges; never re-serialise a whole document (`toString()`, ruamel `dump`), which rewrites WireViz's nested connection-list layout. The back-end never writes YAML through ruamel. Evidence: `spike/README.md`.

License: GPL-3.0 (WireViz is GPL-3.0 and is imported as a library).
