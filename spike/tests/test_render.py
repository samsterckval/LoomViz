from pathlib import Path

import pytest
import yaml
from wireviz import wireviz

from render import render_svg

FIXTURE = Path(__file__).parents[2] / "examples" / "loom" / "demo02.yml"

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


def test_renders_fixture_to_svg():
    result = render_svg(FIXTURE.read_text(encoding="utf-8"))
    assert "<svg" in result.svg[:500]
    # Every component of the fixture appears in the diagram.
    for designator in ["X1", "X2", "X3", "X4", "W1", "W2", "W3", "W4"]:
        assert f">{designator}<" in result.svg
    assert result.warnings == []


def test_no_state_leaks_between_renders():
    a = FIXTURE.read_text(encoding="utf-8")
    first = render_svg(a).svg
    render_svg(CONNECTED)
    assert render_svg(a).svg == first


def test_upstream_mutable_default_leaks_when_given_a_path(tmp_path):
    """Documents the wireviz 0.4.1 behaviour render_svg works around: parse() appends
    to its default image_paths list whenever it reads from a file path."""
    defaults_before = list(wireviz.parse.__defaults__[-1])
    try:
        wireviz.parse(FIXTURE, return_types="svg")
        assert len(wireviz.parse.__defaults__[-1]) > len(defaults_before)
    finally:
        wireviz.parse.__defaults__[-1].clear()
        wireviz.parse.__defaults__[-1].extend(defaults_before)


def test_syntax_error_has_line_number():
    with pytest.raises(yaml.YAMLError) as exc:
        render_svg("connectors:\n  X1:\n    pincount: 2\n   bad: [\n")
    assert exc.value.problem_mark.line + 1 == 4


@pytest.mark.parametrize(
    ("yaml_text", "message"),
    [
        (CONNECTED.replace("X1: [1, 2]", "X1: [1, 5]"), "X1:5 not found"),
        (CONNECTED.replace("- X2: [1, 2]", "- X9: [1, 2]"), "X9 is an unknown"),
        (CONNECTED.replace("{pincount: 2}", "{pincount: 2, colour: RD}", 1), "colour"),
    ],
)
def test_semantic_errors_have_message_but_no_line(yaml_text, message):
    with pytest.raises(Exception) as exc:
        render_svg(yaml_text)
    assert message in str(exc.value)
    assert not hasattr(exc.value, "problem_mark")


def test_unconnected_components_only_warn():
    result = render_svg("connectors:\n  X1: {pincount: 2}\n  X2: {pincount: 2}\n")
    assert "<svg" in result.svg[:500]
    assert any("not referenced in any connection set" in w for w in result.warnings)
