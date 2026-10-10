"""CLI: `loomviz <folder>` serves the harness files in <folder>/loom/ (SPEC FR-33)."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .config import Settings
from .lan import detect_lan_hosts
from .security import check_bind


def main() -> None:
    parser = argparse.ArgumentParser(prog="loomviz", description="Web-based editor for WireViz harnesses")
    parser.add_argument(
        "folder",
        type=Path,
        help="the folder to work on, usually a git repository; harness files live in its loom/ subfolder",
    )
    parser.add_argument("--host", help="address to listen on (default 127.0.0.1; 0.0.0.0 with --lan)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--frontend-dist", type=Path, help="folder with the built front-end")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="also reachable from other machines on the local network, at this machine's names and IPs",
    )
    parser.add_argument(
        "--allow-host",
        action="append",
        default=[],
        metavar="NAME",
        help="another host name or IP the browser may use (repeatable)",
    )
    parser.add_argument("--tls-cert", type=Path, help="serve HTTPS with this certificate (PEM)")
    parser.add_argument("--tls-key", type=Path, help="... and this private key (PEM)")
    args = parser.parse_args()

    if os.environ.get("LOOMVIZ_POLL") == "1":
        # Bind mounts that don't deliver file events: make watchfiles poll instead.
        os.environ["WATCHFILES_FORCE_POLLING"] = "true"

    settings = Settings(host=args.host or ("0.0.0.0" if args.lan else "127.0.0.1"), port=args.port)  # noqa: S104
    if args.lan:
        settings.allow_remote = True
        settings.allowed_hosts += detect_lan_hosts()
    settings.allowed_hosts += [h.strip().lower() for h in args.allow_host if h.strip()]
    settings.allowed_hosts = list(dict.fromkeys(settings.allowed_hosts))  # dedupe, keep order
    if args.tls_cert or args.tls_key:
        settings.tls_cert, settings.tls_key = args.tls_cert, args.tls_key
    if bool(settings.tls_cert) != bool(settings.tls_key):
        parser.error("TLS needs both a certificate and a key (--tls-cert and --tls-key)")
    for tls_file in (settings.tls_cert, settings.tls_key):
        if tls_file and not tls_file.is_file():
            parser.error(f"TLS file not found: {tls_file}")
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
    print(f"Open: {settings.launch_url}")
    for url in settings.lan_urls:
        print(f"  or: {url}")
    if settings.allowed_hosts and settings.scheme == "http":
        print(
            "Warning: reachable from the network over plain HTTP: the launch token travels unencrypted. "
            "Use --tls-cert/--tls-key on networks you don't fully trust."
        )
    print(flush=True)
    # access_log=False: the launch URL carries the token in its query string.
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        access_log=False,
        log_level="warning",
        ssl_certfile=str(settings.tls_cert) if settings.tls_cert else None,
        ssl_keyfile=str(settings.tls_key) if settings.tls_key else None,
    )


if __name__ == "__main__":
    main()
