"""Renders the files produced by the TypeScript round-trip spike, to check they are still
valid WireViz with the intended meaning. Skipped when node or the spike's dependencies are
missing."""

import shutil
import subprocess
from pathlib import Path

import pytest

from render import render_svg
from roundtrip import FIXTURE

TS_DIR = Path(__file__).parents[1] / "roundtrip-ts"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (TS_DIR / "node_modules").exists(),
    reason="needs node and `pnpm install` in spike/roundtrip-ts",
)


@pytest.fixture(scope="module")
def outputs(tmp_path_factory) -> dict[str, str]:
    out_dir = tmp_path_factory.mktemp("ts")
    subprocess.run(["node", "roundtrip.ts", "--write", str(out_dir)], cwd=TS_DIR, check=True, capture_output=True)
    return {p.stem: p.read_text(encoding="utf-8") for p in out_dir.glob("*.yml")}


ORIGINAL_SVG = render_svg(FIXTURE.read_text(encoding="utf-8")).svg


@pytest.mark.parametrize("name", ["A-document-unchanged", "B-cst-unchanged", "C-splice-add-connector"])
def test_meaning_unchanged(outputs, name):
    assert render_svg(outputs[name]).svg == ORIGINAL_SVG


@pytest.mark.parametrize("name", ["A-document-edit", "B-cst-edit", "C-splice-edit"])
def test_length_edit_reaches_the_diagram(outputs, name):
    svg = render_svg(outputs[name]).svg
    assert svg != ORIGINAL_SVG
    assert ">0.25 m<" in svg and ">0.25 m<" not in ORIGINAL_SVG


def test_added_connector_is_parsed_by_wireviz(outputs):
    warnings = render_svg(outputs["C-splice-add-connector"]).warnings
    assert "X5" in warnings  # known to wireviz, but not connected yet
