"""Render service: WireViz YAML -> SVG in worker processes (SPEC FR-11 to FR-14, PLAN D14).

- wireviz runs in a process pool, so a hung Graphviz call can be killed (timeout) without
  affecting the server; the pool is replaced afterwards.
- Results are cached by content: YAML text, file path, wireviz version and referenced images.
- Images referenced by relative path resolve against the edited file's folder and must stay
  inside loom/; wireviz then inlines them into the SVG as data URIs.
- Errors never raise to the client: the response is {"error", "line"} instead of {"svg"}.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import io
import json
import multiprocessing
import os
import re
import time
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Any

import yaml

WIREVIZ_VERSION = "0.4.1"
COMPONENT_SECTIONS = ("connectors", "cables")


# --- worker side (runs in a child process) ----------------------------------------------------


def _image_refs(data: Any) -> list[tuple[dict[str, Any], str]]:
    """(image dict, src) for every component with `image: {src: ...}`."""
    refs = []
    if isinstance(data, dict):
        for section in COMPONENT_SECTIONS:
            components = data.get(section)
            if isinstance(components, dict):
                for attribs in components.values():
                    image = attribs.get("image") if isinstance(attribs, dict) else None
                    if isinstance(image, dict) and isinstance(image.get("src"), str):
                        refs.append((image, image["src"]))
    return refs


def resolve_image(src: str, base_dir: Path, loom: Path) -> Path | None:
    """Absolute path of an image inside loom/, or None if it escapes loom/ or doesn't exist."""
    candidate = (base_dir / src).resolve()
    if not candidate.is_relative_to(loom.resolve()) or not candidate.is_file():
        return None
    return candidate


def _group_warnings(printed: str) -> list[str]:
    """wireviz prints each warning as a 'Warning: ...' line plus continuation lines."""
    warnings: list[str] = []
    for line in (raw.strip() for raw in printed.splitlines()):
        if not line:
            continue
        if line.lower().startswith("warning") or not warnings:
            warnings.append(line)
        else:
            warnings[-1] += " " + line
    return warnings


def render_job(yaml_text: str, base_dir: str, loom: str) -> dict[str, Any]:
    """Render in a worker. Returns {"svg", "warnings"} or {"error", "line", "kind"}."""
    if os.environ.get("LOOMVIZ_TEST_HOOKS") == "1" and "# test:sleep" in yaml_text:
        time.sleep(60)
    from wireviz import wireviz

    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None) or getattr(exc, "context_mark", None)
        problem = getattr(exc, "problem", None) or str(exc)
        line = mark.line + 1 if mark else None
        return {"error": f"YAML syntax error: {problem}", "line": line, "kind": "syntax"}
    if not isinstance(data, dict):
        return {
            "error": "A harness file must be a YAML mapping (connectors, cables, connections, ...)",
            "line": 1,
            "kind": "structure",
        }

    warnings: list[str] = []
    for image, src in _image_refs(data):
        resolved = resolve_image(src, Path(base_dir), Path(loom))
        if resolved is None:
            warnings.append(f"Image not found inside loom/: {src}")
            image.clear()  # drop the image rather than let wireviz read outside loom/
        else:
            image["src"] = str(resolved)
    for section in COMPONENT_SECTIONS:  # wireviz rejects an empty image dict; remove it entirely
        for attribs in (data.get(section) or {}).values():
            if isinstance(attribs, dict) and attribs.get("image") == {}:
                del attribs["image"]

    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            # A fresh image_paths list every time: wireviz.parse() mutates its default (spike §1).
            svg = wireviz.parse(data, return_types="svg", image_paths=[Path(base_dir)])
    except Exception as exc:  # wireviz raises bare Exception / TypeError for harness errors
        return {"error": str(exc) or type(exc).__name__, "line": None, "kind": "harness"}
    return {"svg": svg, "warnings": warnings + _group_warnings(captured.getvalue())}


# --- line lookup for harness errors (main process) --------------------------------------------

_DESIGNATOR_PATTERNS = (
    re.compile(r"^([^\s:]+):\S+ not found"),  # "X1:5 not found."
    re.compile(r"^(\S+) is an unknown"),  # "X9 is an unknown template/designator/arrow."
    re.compile(r"unexpected keyword argument '([^']+)'"),  # TypeError on an unknown attribute
)


def _walk(node: yaml.Node, section: str | None, out: list[tuple[str | None, str, int]]) -> None:
    if isinstance(node, yaml.MappingNode):
        for key, value in node.value:
            if isinstance(key, yaml.ScalarNode):
                out.append((section, key.value, key.start_mark.line + 1))
            key_name = key.value if isinstance(key, yaml.ScalarNode) else None
            _walk(value, section or key_name, out)
    elif isinstance(node, yaml.SequenceNode):
        for item in node.value:
            _walk(item, section, out)
    elif isinstance(node, yaml.ScalarNode):
        out.append((section, node.value.rstrip("."), node.start_mark.line + 1))


def find_error_line(yaml_text: str, message: str) -> int | None:
    """Best-effort line for a wireviz error that names a designator or attribute."""
    token = next((m.group(1) for p in _DESIGNATOR_PATTERNS if (m := p.search(message))), None)
    if token is None:
        return None
    try:
        root = yaml.compose(yaml_text)
    except yaml.YAMLError:
        return None
    if root is None:
        return None
    entries: list[tuple[str | None, str, int]] = []
    _walk(root, None, entries)
    in_connections = [line for section, value, line in entries if section == "connections" and value == token]
    anywhere = [line for _, value, line in entries if value == token]
    matches = in_connections or anywhere
    return matches[0] if matches else None


# --- service (main process) -------------------------------------------------------------------


class Renderer:
    def __init__(
        self, loom: Path, *, workers: int = 2, timeout_s: float = 10.0, cache_size: int = 128
    ) -> None:
        self.loom = loom
        self.workers = workers
        self.timeout_s = timeout_s
        self.cache_size = cache_size
        self.cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.jobs_run = 0  # renders that reached the pool (tests use this to observe the cache)
        self._pool = self._new_pool()

    def _new_pool(self) -> ProcessPoolExecutor:
        return ProcessPoolExecutor(max_workers=self.workers, mp_context=multiprocessing.get_context("spawn"))

    def _restart_pool(self) -> None:
        old = self._pool
        self._pool = self._new_pool()
        for process in list(getattr(old, "_processes", {}).values()):
            process.terminate()
        old.shutdown(wait=False, cancel_futures=True)

    def warm_up(self) -> None:
        """Start every worker and import wireviz there, so the first real render is fast."""
        for _ in range(self.workers):
            self._pool.submit(render_job, "connectors: {}\n", str(self.loom), str(self.loom))

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def base_dir(self, path: Path | None) -> Path:
        return path.parent if path else self.loom

    def cache_key(self, yaml_text: str, path: Path | None) -> str:
        base = self.base_dir(path)
        images: list[Any] = []
        if "image" in yaml_text:
            try:
                data = yaml.safe_load(yaml_text)
            except yaml.YAMLError:
                data = None
            for _, src in _image_refs(data):
                resolved = resolve_image(src, base, self.loom)
                stat = resolved.stat() if resolved else None
                images.append([src, stat.st_size if stat else None, stat.st_mtime_ns if stat else None])
        material = json.dumps([yaml_text, str(path) if path else None, WIREVIZ_VERSION, images])
        return hashlib.sha256(material.encode()).hexdigest()

    async def render(self, yaml_text: str, path: Path | None = None) -> dict[str, Any]:
        key = self.cache_key(yaml_text, path)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]

        self.jobs_run += 1
        future = self._pool.submit(render_job, yaml_text, str(self.base_dir(path)), str(self.loom))
        try:
            result = await asyncio.wait_for(asyncio.wrap_future(future), timeout=self.timeout_s)
        except TimeoutError:
            self._restart_pool()
            return {
                "error": f"Rendering took longer than {self.timeout_s:g} s and was stopped",
                "line": None,
                "kind": "timeout",
            }
        except BrokenProcessPool:
            self._restart_pool()
            return {"error": "The render worker crashed; please try again", "line": None, "kind": "internal"}

        if "error" in result and result.get("line") is None and result.get("kind") == "harness":
            result["line"] = find_error_line(yaml_text, result["error"])
        if "svg" in result or result.get("kind") in ("syntax", "structure", "harness"):
            self.cache[key] = result
            if len(self.cache) > self.cache_size:
                self.cache.popitem(last=False)
        return result
