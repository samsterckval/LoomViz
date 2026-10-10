import pytest
from ruamel.yaml.constructor import DuplicateKeyError

from render import render_svg
from roundtrip import FIXTURE, changed_lines, comments, dump, list_form_variant, load

ORIGINAL = FIXTURE.read_text(encoding="utf-8")
VARIANT = list_form_variant(ORIGINAL)


def test_ruamel_rejects_repeated_merge_keys_in_upstream_demo():
    """wireviz (PyYAML) accepts two `<<` keys in one mapping; ruamel never does."""
    with pytest.raises(DuplicateKeyError):
        load(ORIGINAL)


def test_variant_only_rewrites_the_merge_lines():
    assert VARIANT.count("<<: [*molex_f, *con_i2c]") == 2
    assert len(changed_lines(ORIGINAL, VARIANT)) == 6  # 4 lines removed, 2 added


def test_variant_renders_the_same_diagram_as_original():
    assert render_svg(VARIANT).svg == render_svg(ORIGINAL).svg


def test_all_comments_survive_a_round_trip():
    assert sorted(comments(dump(load(VARIANT)))) == sorted(comments(VARIANT))


def test_round_trip_keeps_meaning():
    assert render_svg(dump(load(VARIANT))).svg == render_svg(VARIANT).svg


def test_one_value_edit_changes_one_line_relative_to_unchanged_dump():
    baseline = dump(load(VARIANT))
    data = load(VARIANT)
    data["cables"]["W1"]["length"] = 0.25
    assert changed_lines(baseline, dump(data)) == ["-    length: 0.2", "+    length: 0.25"]


@pytest.mark.xfail(strict=True, reason="ruamel reformats nested connection lists, flow-list spacing "
                   "and a comment after an alias; see spike/README.md")
def test_unchanged_round_trip_is_byte_identical():
    assert dump(load(VARIANT)) == VARIANT
