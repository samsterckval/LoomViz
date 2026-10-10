"""Against a real uvicorn server (the test client bypasses uvicorn, so it can't catch missing
WebSocket support or similar server-level problems)."""

import json
import socket
import threading
import time

import pytest
import uvicorn
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from loomviz.app import create_app
from loomviz.config import Settings

from .conftest import TOKEN


@pytest.fixture
def server(workspace, tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    settings = Settings(workspace=workspace, port=port, token=TOKEN, frontend_dist=tmp_path / "no-dist")
    app = create_app(settings)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    instance = uvicorn.Server(config)
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not instance.started and time.monotonic() < deadline:
        time.sleep(0.05)
    yield port
    instance.should_exit = True
    thread.join(timeout=10)


def test_events_websocket_on_a_real_server(server, workspace):
    url = f"ws://127.0.0.1:{server}/ws/events?token={TOKEN}"
    with connect(url, origin=f"http://127.0.0.1:{server}", open_timeout=5) as ws:
        # The watcher starts asynchronously and file events can lag on a busy machine: keep
        # editing until an event for the file arrives.
        deadline = time.monotonic() + 20
        n = 0
        while time.monotonic() < deadline:
            n += 1
            (workspace / "loom" / "demo02.yml").write_text(f"connectors: {{}}  # {n}\n")
            try:
                while True:
                    event = json.loads(ws.recv(timeout=1.5))
                    if event["type"] == "files" and "demo02.yml" in event["changed"] + event["added"]:
                        return
            except TimeoutError:
                continue
        raise AssertionError("no files event for demo02.yml within 20 s")


def test_real_server_rejects_websocket_without_token(server):
    with pytest.raises(InvalidStatus):  # handshake refused (closed before accept)
        with connect(
            f"ws://127.0.0.1:{server}/ws/events", origin=f"http://127.0.0.1:{server}", open_timeout=5
        ) as ws:
            ws.recv(timeout=2)
