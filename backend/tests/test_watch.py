"""File and git change events (FR-9, FR-34)."""

import asyncio
import subprocess
import time
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect
from watchfiles import Change

from loomviz.watch import EventHub, files_event, run_watchers

from .conftest import TOKEN


def test_files_event_classifies_and_filters(tmp_path):
    loom = tmp_path / "loom"
    (loom / "sub").mkdir(parents=True)
    (loom / "new.yml").write_text("n: 1\n")
    (loom / "sub" / "a.yaml").write_text("a: 1\n")
    event = files_event(
        {
            (Change.added, str(loom / "new.yml")),
            (Change.modified, str(loom / "sub" / "a.yaml")),
            (Change.deleted, str(loom / "old.yml")),
            (Change.added, str(loom / ".loomviz-tmp-abc")),  # our own temp file
            (Change.modified, str(loom / ".hidden.yml")),
            (Change.modified, str(tmp_path / "README.md")),  # outside loom/
        },
        loom,
    )
    assert event == {
        "type": "files",
        "added": ["new.yml"],
        "changed": ["sub/a.yaml"],
        "deleted": ["old.yml"],
        "other": False,
    }


def test_files_event_reports_images_as_other(tmp_path):
    loom = tmp_path / "loom"
    event = files_event({(Change.modified, str(loom / "images" / "x.png"))}, loom)
    assert event is not None and event["other"] is True and event["changed"] == []


def test_merged_flags_are_resolved_from_disk(tmp_path):
    loom = tmp_path / "loom"
    loom.mkdir()
    (loom / "replaced.yml").write_text("x: 1\n")
    event = files_event(
        {
            # Atomic replace: reported as deleted + added, and the file exists.
            (Change.deleted, str(loom / "replaced.yml")),
            (Change.added, str(loom / "replaced.yml")),
            # Created then removed quickly: reported as added (and modified), but it's gone.
            (Change.added, str(loom / "gone.yml")),
            (Change.modified, str(loom / "gone.yml")),
        },
        loom,
    )
    assert event == {
        "type": "files",
        "added": [],
        "changed": ["replaced.yml"],
        "deleted": ["gone.yml"],
        "other": False,
    }


def test_nothing_relevant_gives_no_event(tmp_path):
    assert files_event({(Change.modified, str(tmp_path / "x.yml"))}, tmp_path / "loom") is None


async def collect(
    root: Path, action, until, timeout: float = 10.0, retry_every: float | None = None
) -> list[dict]:
    """Run the watchers, perform `action` once they're up, and collect events until `until(events)`.

    Watchers start asynchronously (the git watcher first asks git for its directory), so under
    load the first action can happen before they watch; `retry_every` repeats the action.
    """
    hub = EventHub()
    queue = hub.subscribe()
    stop = asyncio.Event()
    task = asyncio.create_task(run_watchers(root, hub, stop))
    events: list[dict] = []
    loop = asyncio.get_running_loop()
    try:
        await asyncio.sleep(0.6)  # let the watchers start
        action()
        deadline = loop.time() + timeout
        next_retry = loop.time() + retry_every if retry_every else None
        while not until(events) and loop.time() < deadline:
            wait = deadline - loop.time()
            if next_retry is not None:
                wait = min(wait, max(0.0, next_retry - loop.time()))
            try:
                events.append(await asyncio.wait_for(queue.get(), wait))
            except TimeoutError:
                if next_retry is not None and loop.time() >= next_retry:
                    action()
                    next_retry = loop.time() + retry_every
    finally:
        stop.set()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    return events


def all_paths(events: list[dict], key: str) -> set[str]:
    return {p for e in events if e["type"] == "files" for p in e[key]}


def test_watcher_reports_created_modified_and_deleted_files(tmp_path):
    (tmp_path / "loom").mkdir()
    existing = tmp_path / "loom" / "a.yml"
    existing.write_text("a: 1\n")
    edits = iter(range(1000))

    def act():  # repeatable: fresh content each time
        n = next(edits)
        (tmp_path / "loom" / "new.yml").write_text(f"n: {n}\n")
        existing.write_text(f"a: {n + 2}\n")
        (tmp_path / "outside.yml").write_text(f"o: {n}\n")

    events = asyncio.run(
        collect(
            tmp_path,
            act,
            lambda ev: {"new.yml", "a.yml"} <= all_paths(ev, "added") | all_paths(ev, "changed"),
            retry_every=1.5,
        )
    )
    seen = all_paths(events, "added") | all_paths(events, "changed")
    assert {"new.yml", "a.yml"} <= seen
    assert "outside.yml" not in seen

    def delete():  # repeatable: re-create first if an earlier attempt already removed it
        if not existing.exists():
            existing.write_text("a: again\n")
            time.sleep(0.3)
        existing.unlink()

    events = asyncio.run(
        collect(tmp_path, delete, lambda ev: "a.yml" in all_paths(ev, "deleted"), retry_every=1.5)
    )
    assert "a.yml" in all_paths(events, "deleted")


def test_watcher_notices_loom_folder_being_created(tmp_path):
    loom = tmp_path / "loom"

    def create():  # repeatable
        if loom.exists():
            loom.rmdir()
            time.sleep(0.3)
        loom.mkdir()

    events = asyncio.run(
        collect(tmp_path, create, lambda ev: any(e["type"] == "files" for e in ev), retry_every=2.0)
    )
    assert any(e["type"] == "files" for e in events)


def test_git_event_on_branch_switch(tmp_path):
    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=T", "-c", "user.email=t@e", "-c", "init.defaultBranch=main", *args],
            cwd=tmp_path,
            check=True,
            capture_output=True,
        )

    (tmp_path / "loom").mkdir()
    (tmp_path / "loom" / "a.yml").write_text("a: 1\n")
    git("init")
    git("add", ".")
    git("commit", "-m", "init")
    branches = iter(f"feature-{i}" for i in range(100))
    events = asyncio.run(
        collect(
            tmp_path,
            lambda: git("checkout", "-q", "-b", next(branches)),
            lambda ev: any(e["type"] == "git" for e in ev),
            retry_every=1.5,
        )
    )
    assert any(e["type"] == "git" for e in events)


# Starlette's test client sends "Host: testserver" on WebSockets regardless of base_url.
WS_HOST = {"host": "127.0.0.1:8000"}


def test_websocket_requires_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/events", headers=WS_HOST):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/events?token=wrong", headers=WS_HOST):
            pass


def test_websocket_rejects_foreign_origin(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/ws/events?token={TOKEN}", headers={**WS_HOST, "Origin": "https://evil.example"}
        ):
            pass


def test_websocket_refuses_testserver_host(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/events?token={TOKEN}"):
            pass


def test_websocket_delivers_events(client):
    hub = client.app.state.hub
    with client.websocket_connect(f"/ws/events?token={TOKEN}", headers=WS_HOST) as ws:
        client.portal.call(hub.publish, {"type": "git"})
        assert ws.receive_json() == {"type": "git"}
