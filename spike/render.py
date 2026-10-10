"""M0 spike: render a WireViz YAML string to SVG through the wireviz library.

Usage:
    uv run python render.py ../examples/loom/demo02.yml > out/demo02.svg

Warnings that wireviz prints go to stderr; the SVG goes to stdout.
"""

from __future__ import annotations

import contextlib
import io
import sys
from dataclasses import dataclass
from pathlib import Path

from wireviz import wireviz


@dataclass
class RenderResult:
    svg: str
    warnings: list[str]


def render_svg(yaml_text: str, image_dir: Path | None = None) -> RenderResult:
    """Render YAML text to an SVG string, entirely in memory.

    image_dir is where relative image paths are resolved. A fresh list is passed on
    every call: wireviz.parse() uses a mutable default (image_paths=[]) that it
    appends to, which would otherwise leak state between calls.
    """
    image_paths: list[Path] = [image_dir] if image_dir else []
    captured = io.StringIO()
    # wireviz reports warnings with print(); capture them instead of polluting stdout.
    with contextlib.redirect_stdout(captured):
        svg = wireviz.parse(yaml_text, return_types="svg", image_paths=image_paths)
    warnings = [line for line in captured.getvalue().splitlines() if line.strip()]
    return RenderResult(svg=svg, warnings=warnings)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    result = render_svg(path.read_text(encoding="utf-8"), image_dir=path.parent.resolve())
    for warning in result.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    sys.stdout.write(result.svg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
