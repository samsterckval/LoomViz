"""Runtime settings, built once at startup by the CLI (or by tests)."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

LOOM_FOLDER = "loom"  # harness files live here, relative to the repository root (D13)


def _default_frontend_dist() -> Path:
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


@dataclass
class Settings:
    # The folder LoomViz serves (usually a git repository root with a loom/ folder). None only in tests.
    workspace: Path | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    token: str = field(default_factory=lambda: os.environ.get("LOOMVIZ_TOKEN") or secrets.token_urlsafe(32))
    allow_remote: bool = field(default_factory=lambda: os.environ.get("LOOMVIZ_ALLOW_REMOTE") == "1")
    frontend_dist: Path = field(default_factory=_default_frontend_dist)
    render_timeout_s: float = 10.0
    render_workers: int = 2
    render_cache_size: int = 128

    @property
    def launch_url(self) -> str:
        host = "127.0.0.1" if self.host in ("0.0.0.0", "::") else self.host  # noqa: S104
        return f"http://{host}:{self.port}/?token={self.token}"
