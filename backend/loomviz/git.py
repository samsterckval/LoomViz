"""Read-only git status for the header (SPEC FR-34, PLAN D16).

LoomViz never changes the repository: only `rev-parse` and `status` run, with optional locks
off (so `status` doesn't refresh the index), fsmonitor disabled, no prompts, no shell and a
timeout. Anything unexpected (no git, not a repository, timeout) reports "no repository".
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from .config import LOOM_FOLDER

TIMEOUT_S = 5.0
SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"]


def _git(workspace: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    env = {
        **os.environ,
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }
    return subprocess.run(  # noqa: S603 - fixed argument list, no shell
        ["git", "-C", str(workspace), *SAFE_CONFIG, *args],  # noqa: S607 - git from PATH
        capture_output=True,
        timeout=TIMEOUT_S,
        env=env,
        check=False,
    )


def _kind(code: str, xy: str) -> str:
    if code == "?":
        return "untracked"
    if code == "u":
        return "conflicted"
    if code == "2":
        return "renamed"
    if "D" in xy:
        return "deleted"
    if "A" in xy:
        return "added"
    return "modified"


def parse_porcelain_v2(output: bytes, loom_prefix: str) -> dict[str, Any]:
    """Parse `git status --porcelain=v2 --branch -z` output.

    loom_prefix is the loom folder's path relative to the repository root, with a trailing
    slash (porcelain paths are always relative to the repository root).
    """
    branch: str | None = None
    detached = False
    changed: list[dict[str, str]] = []
    fields = output.decode("utf-8", errors="replace").split("\0")
    i = 0
    while i < len(fields):
        entry = fields[i]
        i += 1
        if not entry:
            continue
        if entry.startswith("# branch.head "):
            head = entry[len("# branch.head ") :]
            detached = head == "(detached)"
            branch = None if detached else head
            continue
        if entry.startswith("#"):
            continue
        code = entry[0]
        if code == "?":
            path = entry[2:]
            xy = "??"
        elif code in "12u":
            # "1 XY sub mH mI mW hH hI path", "2 XY ... Xscore path" (+ orig path field), "u XY ... path"
            parts = entry.split(" ", {"1": 8, "2": 9, "u": 10}[code])
            xy, path = parts[1], parts[-1]
            if code == "2":
                i += 1  # skip the original path
        else:
            continue  # "!" ignored entries (not requested)
        if path.startswith(loom_prefix):
            changed.append({"path": path[len(loom_prefix) :], "status": _kind(code, xy)})
    return {"repository": True, "branch": branch, "detached": detached, "changed": changed}


def status(workspace: Path) -> dict[str, Any]:
    try:
        top = _git(workspace, "rev-parse", "--show-toplevel")
        if top.returncode != 0:
            return {"repository": False}
        root = Path(top.stdout.decode().strip()).resolve()
        loom = (workspace / LOOM_FOLDER).resolve()
        if not loom.is_relative_to(root):
            return {"repository": False}
        prefix = loom.relative_to(root).as_posix() + "/"
        result = _git(
            workspace,
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
            "--",
            f"{LOOM_FOLDER}/",
        )
        if result.returncode != 0:
            return {"repository": False}
        return parse_porcelain_v2(result.stdout, prefix)
    except (OSError, subprocess.TimeoutExpired):
        return {"repository": False}
