import asyncio
import io
import time
from pathlib import Path

import pytest
from PIL import Image

from loomviz.render import Renderer, find_error_line

from .conftest import DEMO

CONNECTED = """\
connectors:
  X1: {pincount: 2}
  X2: {pincount: 2}
cables:
  W1: {wirecount: 2}
connections:
  - - X1: [1, 2]
    - W1: [1, 2]
    - X2: [1, 2]
"""


def write_png(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="PNG")
    path.write_bytes(buffer.getvalue())


def with_image(src: str) -> str:
    return CONNECTED.replace("X1: {pincount: 2}", f"X1:\n    pincount: 2\n    image:\n      src: {src}")


def render(client, yaml_text: str, path: str | None = None) -> dict:
    response = client.post("/api/render", json={"yaml": yaml_text, "path": path})
    assert response.status_code == 200
    return response.json()


def test_renders_demo(client):
    result = render(client, DEMO.read_text())
    assert "<svg" in result["svg"][:500]
    assert ">X4<" in result["svg"]
    assert result["warnings"] == []


def test_warnings_are_grouped(client):
    result = render(client, "connectors:\n  X1: {pincount: 2}\n  X2: {pincount: 2}\n")
    assert "svg" in result
    assert result["warnings"] == [
        "Warning: The following components are not referenced in any connection set: X1, X2"
    ]


def test_syntax_error_has_line(client):
    result = render(client, "connectors:\n  X1:\n    pincount: 2\n   bad: [\n")
    assert "svg" not in result
    assert result["kind"] == "syntax"
    assert result["line"] == 4


def test_not_a_mapping(client):
    assert render(client, "- a\n- b\n")["kind"] == "structure"


@pytest.mark.parametrize(
    ("yaml_text", "message", "line"),
    [
        (CONNECTED.replace("X1: [1, 2]", "X1: [1, 5]"), "X1:5 not found", 7),
        (CONNECTED.replace("- X2: [1, 2]", "- X9: [1, 2]"), "X9 is an unknown", 9),
        (CONNECTED.replace("{pincount: 2}", "{pincount: 2, colour: RD}", 1), "colour", 2),
    ],
)
def test_harness_errors_get_a_line(client, yaml_text, message, line):
    result = render(client, yaml_text)
    assert result["kind"] == "harness"
    assert message in result["error"]
    assert result["line"] == line


def test_find_error_line_without_match():
    assert find_error_line(CONNECTED, "something unexpected") is None


def test_image_is_inlined_relative_to_file(client, workspace):
    write_png(workspace / "loom" / "images" / "red.png")
    (workspace / "loom" / "sub" / "img.yml").write_text(with_image("../images/red.png"))
    result = render(client, with_image("../images/red.png"), path="sub/img.yml")
    assert "data:image/png;base64," in result["svg"]
    assert "red.png" not in result["svg"]
    assert result["warnings"] == []


def test_image_outside_loom_is_dropped_with_warning(client, workspace):
    write_png(workspace / "secret.png")
    result = render(client, with_image("../secret.png"), path="demo02.yml")
    assert "svg" in result
    assert "data:image" not in result["svg"]
    assert result["warnings"] == ["Image not found inside loom/: ../secret.png"]


def test_render_path_is_sandboxed(client):
    response = client.post("/api/render", json={"yaml": CONNECTED, "path": "../README.md"})
    assert response.status_code == 400


def test_cache_hits_and_misses(workspace):
    renderer = Renderer(workspace / "loom", workers=1)
    try:
        run = asyncio.run
        first = run(renderer.render(CONNECTED))
        assert renderer.jobs_run == 1
        assert run(renderer.render(CONNECTED)) is first
        assert renderer.jobs_run == 1
        run(renderer.render(CONNECTED + "# changed\n"))
        assert renderer.jobs_run == 2

        image = workspace / "loom" / "red.png"
        write_png(image)
        text = with_image("red.png")
        run(renderer.render(text))
        run(renderer.render(text))
        assert renderer.jobs_run == 3
        time.sleep(0.01)
        Image.new("RGB", (9, 9)).save(image)  # same name, new content and mtime
        run(renderer.render(text))
        assert renderer.jobs_run == 4
    finally:
        renderer.close()


def test_timeout_kills_worker_and_service_recovers(workspace, monkeypatch):
    monkeypatch.setenv("LOOMVIZ_TEST_HOOKS", "1")  # inherited by the spawned workers
    renderer = Renderer(workspace / "loom", workers=1, timeout_s=2)
    try:
        started = time.monotonic()
        result = asyncio.run(renderer.render(CONNECTED + "# test:sleep\n"))
        assert result["kind"] == "timeout"
        assert time.monotonic() - started < 10
        assert "svg" in asyncio.run(renderer.render(CONNECTED))
    finally:
        renderer.close()
