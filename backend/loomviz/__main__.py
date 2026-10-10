"""CLI: `loomviz <folder>` serves the harness files in <folder>/loom/ (SPEC FR-33)."""

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
        "folder",
        type=Path,
        help="the folder to work on, usually a git repository; harness files live in its loom/ subfolder",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--frontend-dist", type=Path, help="folder with the built front-end")
    args = parser.parse_args()

    settings = Settings(host=args.host, port=args.port)
    if not args.folder.is_dir():
        parser.error(f"{args.folder} is not a folder")
    settings.workspace = args.folder.resolve()
    if args.frontend_dist:
        settings.frontend_dist = args.frontend_dist.resolve()
    check_bind(settings)

    app = create_app(settings)
    print(f"LoomViz on {settings.workspace}")
    if not (settings.workspace / "loom").is_dir():
        print("No loom/ folder yet; the page offers to create it.")
    if not settings.frontend_dist.is_dir():
        print(f"Front-end not built ({settings.frontend_dist} missing): API only.")
        print("Run `pnpm install && pnpm build` in frontend/ to get the UI.")
    print(f"Open: {settings.launch_url}", flush=True)
    # access_log=False: the launch URL carries the token in its query string.
    uvicorn.run(app, host=settings.host, port=settings.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
