"""Runtime settings, built once at startup by the CLI (or by tests)."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

LOOM_FOLDER = "loom"  # harness files live here, relative to the repository root (D13)


def _default_frontend_dist() -> Path:
    # LOOMVIZ_FRONTEND_DIST is set in the Docker image, where the package can't find the
    # front-end relative to itself.
    configured = os.environ.get("LOOMVIZ_FRONTEND_DIST")
    return Path(configured) if configured else Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _env_port(name: str) -> int | None:
    value = os.environ.get(name)
    return int(value) if value else None


@dataclass
class Settings:
    # The folder LoomViz serves (usually a git repository root with a loom/ folder). None only in tests.
    workspace: Path | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    # The port the browser uses, if it differs from the one we listen on (Docker publishes the
    # container's port 8000 on a host port of the user's choice). Host/Origin checks use it.
    public_port: int | None = field(default_factory=lambda: _env_port("LOOMVIZ_PUBLIC_PORT"))
    token: str = field(default_factory=lambda: os.environ.get("LOOMVIZ_TOKEN") or secrets.token_urlsafe(32))
    allow_remote: bool = field(default_factory=lambda: os.environ.get("LOOMVIZ_ALLOW_REMOTE") == "1")
    frontend_dist: Path = field(default_factory=_default_frontend_dist)
    render_timeout_s: float = 10.0
    render_workers: int = 2
    render_cache_size: int = 128

    @property
    def browser_port(self) -> int:
        return self.public_port or self.port

    @property
    def launch_url(self) -> str:
        # When listening on all interfaces (in a container), the browser still uses 127.0.0.1.
        host = "127.0.0.1" if self.host in ("0.0.0.0", "::") else self.host  # noqa: S104
        return f"http://{host}:{self.browser_port}/?token={self.token}"
