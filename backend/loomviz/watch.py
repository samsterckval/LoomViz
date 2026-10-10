"""File and git change events (SPEC FR-9, FR-34).

Two narrow watchers, so large repositories stay cheap:
- loom/, recursively (or the workspace root, non-recursively, until loom/ appears);
- the git directory, non-recursively: branch switches, commits and staging touch HEAD or index.

Events go to every connected `/ws/events` client:
  {"type": "files", "added": [...], "changed": [...], "deleted": [...], "other": bool}
      YAML paths relative to loom/; "other" means a non-YAML file (image, template) changed.
  {"type": "git"}
LoomViz's own writes are reported too; the front-end recognises them by ETag.
"""

from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
from typing import Any

from watchfiles import Change, awatch

from .config import LOOM_FOLDER
from .files import TEMP_PREFIX, YAML_SUFFIXES
from .git import git_dir

DEBOUNCE_MS = 200
GIT_FILES = {"HEAD", "index", "packed-refs", "ORIG_HEAD", "FETCH_HEAD"}


class EventHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers):
            with contextlib.suppress(asyncio.QueueFull):  # a stuck client misses events, others don't
                queue.put_nowait(event)


def files_event(changes: set[tuple[Change, str]], loom: Path) -> dict[str, Any] | None:
    added: set[str] = set()
    changed: set[str] = set()
    deleted: set[str] = set()
    other = False
    for change, raw in changes:
        path = Path(raw)
        try:
            rel = path.relative_to(loom)
        except ValueError:
            continue
        if any(part.startswith(".") for part in rel.parts) or path.name.startswith(TEMP_PREFIX):
            continue  # hidden files and our own atomic-write temp files
        if path.suffix.lower() not in YAML_SUFFIXES:
            other = True
            continue
        name = rel.as_posix()
        {Change.added: added, Change.modified: changed, Change.deleted: deleted}[change].add(name)
    # Event flags get merged (macOS reports a file's recent history; an atomic replace shows up as
    # added + deleted), so let the disk decide: a file that exists now was added or changed,
    # one that doesn't was deleted.
    for name in list(added | changed | deleted):
        exists = (loom / name).is_file()
        if exists and name in deleted:  # deleted and back again: replaced, i.e. changed
            deleted.discard(name)
            added.discard(name)
            changed.add(name)
        elif not exists:
            added.discard(name)
            changed.discard(name)
            deleted.add(name)
    for name in added & changed:
        added.discard(name)  # existed before, so "changed"
    if not (added or changed or deleted or other):
        return None
    return {
        "type": "files",
        "added": sorted(added - changed),
        "changed": sorted(changed),
        "deleted": sorted(deleted - changed),
        "other": other,
    }


async def watch_loom(root: Path, hub: EventHub, stop: asyncio.Event) -> None:
    loom = root / LOOM_FOLDER
    while not stop.is_set():
        if loom.is_dir():
            loom_real = loom.resolve()
            async for changes in awatch(loom, debounce=DEBOUNCE_MS, stop_event=stop, recursive=True):
                # Paths come back resolved (e.g. /private/var on macOS), so compare with loom resolved.
                event = files_event(changes, loom_real)
                if event:
                    hub.publish(event)
                if not loom.is_dir():
                    break  # loom/ itself was removed; go back to waiting for it
        else:
            async for _ in awatch(root, debounce=DEBOUNCE_MS, stop_event=stop, recursive=False):
                if loom.is_dir():
                    hub.publish({"type": "files", "added": [], "changed": [], "deleted": [], "other": True})
                    break


async def watch_git(root: Path, hub: EventHub, stop: asyncio.Event) -> None:
    directory = await asyncio.to_thread(git_dir, root)
    if directory is None:
        return
    # watch_filter=None: watchfiles' default filter ignores everything inside .git directories.
    async for changes in awatch(
        directory, debounce=DEBOUNCE_MS, stop_event=stop, recursive=False, watch_filter=None
    ):
        if any(Path(path).name in GIT_FILES for _, path in changes):
            hub.publish({"type": "git"})


async def run_watchers(root: Path, hub: EventHub, stop: asyncio.Event) -> None:
    await asyncio.gather(watch_loom(root, hub, stop), watch_git(root, hub, stop))
