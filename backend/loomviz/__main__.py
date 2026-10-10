"""CLI: `loomviz --dev-workspace <dir>` (development mode) or `loomviz` (session mode, from M3)."""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from .app import create_app
from .config import Settings
from .security import check_bind


def main() -> None:
    parser = argparse.ArgumentParser(prog="loomviz", description="Web-based editor for WireViz harnesses")
    parser.add_argument(
        "--dev-workspace",
        type=Path,
        help="development mode: open a session on this folder (a repository root with a loom/ folder)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--frontend-dist", type=Path, help="folder with the built front-end")
    args = parser.parse_args()

    settings = Settings(host=args.host, port=args.port)
    if args.dev_workspace:
        if not args.dev_workspace.is_dir():
            parser.error(f"--dev-workspace {args.dev_workspace} is not a folder")
        settings.dev_workspace = args.dev_workspace.resolve()
    if args.frontend_dist:
        settings.frontend_dist = args.frontend_dist.resolve()
    check_bind(settings)

    app = create_app(settings)
    mode = f"development mode on {settings.dev_workspace}" if settings.dev_workspace else "no session"
    print(f"LoomViz ({mode})")
    if not settings.frontend_dist.is_dir():
        print(f"Front-end not built ({settings.frontend_dist} missing): API only.")
        print("Run `pnpm install && pnpm build` in frontend/ to get the UI.")
    print(f"Open: {settings.launch_url}", flush=True)
    # access_log=False: the launch URL carries the token in its query string.
    uvicorn.run(app, host=settings.host, port=settings.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
