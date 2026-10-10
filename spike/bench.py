"""M0 spike: benchmark WireViz render time.

Usage:
    uv run python bench.py [--runs 7] [--cold-runs 5]

Harnesses: the real fixture (examples/loom/demo02.yml) plus synthetic ones with
5, 20 and 60 connectors, generated in memory. Prints Markdown tables.

Warm = repeated renders in one process (what the app's worker pool sees).
Cold = a fresh Python process per render (import cost + first render).
Phases (warm): parse = YAML load + building the Harness object; graph = building the
Graphviz source; dot = running Graphviz; embed = wireviz's image embedding pass.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import statistics
import subprocess
import sys
import time
from pathlib import Path

from wireviz import wireviz
from wireviz.svgembed import embed_svg_images

FIXTURE = Path(__file__).parent.parent / "examples" / "loom" / "demo02.yml"
COLORS = ["BK", "RD", "YE", "GN", "BU", "OG", "VT", "WH"]


def synthetic(connectors: int) -> str:
    """A chain X1 - W1 - X2 - W2 - ... with 4-wire cables and labelled 4-pin connectors."""
    lines = ["connectors:"]
    for i in range(1, connectors + 1):
        lines += [
            f"  X{i}:",
            "    type: Molex KK 254",
            "    subtype: female",
            "    pinlabels: [GND, VCC, SCL, SDA]",
        ]
    lines.append("cables:")
    for i in range(1, connectors):
        colors = ", ".join(COLORS[(i + k) % len(COLORS)] for k in range(4))
        lines += [
            f"  W{i}:",
            "    gauge: 0.25 mm2",
            f"    length: {0.1 * i:.1f}",
            f"    colors: [{colors}]",
            "    show_equiv: true",
        ]
    lines.append("connections:")
    for i in range(1, connectors):
        lines += [
            "  -",
            f"    - X{i}: [1-4]",
            f"    - W{i}: [1-4]",
            f"    - X{i + 1}: [1-4]",
        ]
    return "\n".join(lines) + "\n"


def cases() -> list[tuple[str, int, str]]:
    return [
        ("demo02 (real)", 5, FIXTURE.read_text(encoding="utf-8")),
        ("synthetic-5", 5, synthetic(5)),
        ("synthetic-20", 20, synthetic(20)),
        ("synthetic-60", 60, synthetic(60)),
    ]


def render_phases(yaml_text: str) -> dict[str, float]:
    t0 = time.perf_counter()
    with contextlib.redirect_stdout(io.StringIO()):
        harness = wireviz.parse(yaml_text, return_types="harness", image_paths=[])
    t1 = time.perf_counter()
    graph = harness.create_graph()
    t2 = time.perf_counter()
    raw = graph.pipe(format="svg")
    t3 = time.perf_counter()
    svg = embed_svg_images(raw.decode("utf-8"), Path.cwd())
    t4 = time.perf_counter()
    assert "<svg" in svg[:500]
    return {"parse": t1 - t0, "graph": t2 - t1, "dot": t3 - t2, "embed": t4 - t3, "total": t4 - t0}


COLD_SCRIPT = """
import time, sys, contextlib, io
t0 = time.perf_counter()
from wireviz import wireviz
t1 = time.perf_counter()
text = sys.stdin.read()
with contextlib.redirect_stdout(io.StringIO()):
    svg = wireviz.parse(text, return_types="svg", image_paths=[])
t2 = time.perf_counter()
assert "<svg" in svg[:500]
print(f"{t1 - t0} {t2 - t1}")
"""


def cold(yaml_text: str) -> dict[str, float]:
    t0 = time.perf_counter()
    out = subprocess.run(
        [sys.executable, "-c", COLD_SCRIPT], input=yaml_text, capture_output=True, text=True, check=True
    ).stdout
    wall = time.perf_counter() - t0
    import_s, render_s = (float(x) for x in out.split())
    return {"import": import_s, "render": render_s, "process": wall}


def ms(seconds: float) -> str:
    return f"{seconds * 1000:.0f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=7)
    parser.add_argument("--cold-runs", type=int, default=5)
    args = parser.parse_args()

    print(f"wireviz {wireviz.__dict__.get('__version__', '0.4.1')}, Python {sys.version.split()[0]}, "
          f"{args.runs} warm runs (after 1 warm-up), {args.cold_runs} cold runs; median in ms\n")

    print("Warm (same process)\n")
    print("| Harness | Connectors | parse | graph | dot | embed | **total** | min–max total |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|")
    for name, n, text in cases():
        render_phases(text)  # warm-up
        runs = [render_phases(text) for _ in range(args.runs)]
        med = {k: statistics.median(r[k] for r in runs) for k in runs[0]}
        totals = [r["total"] for r in runs]
        print(f"| {name} | {n} | {ms(med['parse'])} | {ms(med['graph'])} | {ms(med['dot'])} | "
              f"{ms(med['embed'])} | **{ms(med['total'])}** | {ms(min(totals))}–{ms(max(totals))} |")

    print("\nCold (fresh process per render)\n")
    print("| Harness | import wireviz | first render | whole process |")
    print("|---|---:|---:|---:|")
    for name, _, text in cases():
        runs = [cold(text) for _ in range(args.cold_runs)]
        med = {k: statistics.median(r[k] for r in runs) for k in runs[0]}
        print(f"| {name} | {ms(med['import'])} | {ms(med['render'])} | {ms(med['process'])} |")


if __name__ == "__main__":
    main()
