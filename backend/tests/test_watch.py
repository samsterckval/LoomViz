"""File and git change events (FR-9, FR-34)."""

import asyncio
import subprocess
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


async def collect(root: Path, action, until, timeout: float = 8.0) -> list[dict]:
    """Run the watchers, perform `action` once they're up, and collect events until `until(events)`."""
    hub = EventHub()
    queue = hub.subscribe()
    stop = asyncio.Event()
    task = asyncio.create_task(run_watchers(root, hub, stop))
    events: list[dict] = []
    try:
        await asyncio.sleep(0.6)  # let the watchers start
        action()
        deadline = asyncio.get_running_loop().time() + timeout
        while not until(events):
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                events.append(await asyncio.wait_for(queue.get(), remaining))
            except TimeoutError:
                break
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

    def act():
        (tmp_path / "loom" / "new.yml").write_text("n: 1\n")
        existing.write_text("a: 2\n")
        (tmp_path / "outside.yml").write_text("o: 1\n")

    events = asyncio.run(
        collect(
            tmp_path,
            act,
            lambda ev: {"new.yml", "a.yml"} <= all_paths(ev, "added") | all_paths(ev, "changed"),
        )
    )
    seen = all_paths(events, "added") | all_paths(events, "changed")
    assert {"new.yml", "a.yml"} <= seen
    assert "outside.yml" not in seen

    events = asyncio.run(collect(tmp_path, existing.unlink, lambda ev: "a.yml" in all_paths(ev, "deleted")))
    assert "a.yml" in all_paths(events, "deleted")


def test_watcher_notices_loom_folder_being_created(tmp_path):
    events = asyncio.run(
        collect(
            tmp_path, lambda: (tmp_path / "loom").mkdir(), lambda ev: any(e["type"] == "files" for e in ev)
        )
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
    events = asyncio.run(
        collect(
            tmp_path, lambda: git("checkout", "-b", "feature"), lambda ev: any(e["type"] == "git" for e in ev)
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
