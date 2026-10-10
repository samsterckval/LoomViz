"""M0 spike: does ruamel.yaml round-trip a real WireViz file?

Usage:
    uv run python roundtrip.py

Checks, on examples/loom/demo02.yml:
  1. Can ruamel load it at all? (It uses two `<<` merge keys in one mapping.)
  2. On a variant using the equivalent list form `<<: [*a, *b]`:
     - are all comments kept?
     - is an unchanged load+dump byte-identical? If not, what changes?
     - does changing one value change exactly one line compared to the unchanged dump?
     - does wireviz render the dumped YAML to the same diagram?
"""

from __future__ import annotations

import difflib
import io
import re
from pathlib import Path

from ruamel.yaml import YAML

FIXTURE = Path(__file__).parent.parent / "examples" / "loom" / "demo02.yml"


def list_form_variant(text: str) -> str:
    """Rewrite consecutive `<<: *a` / `<<: *b` lines into `<<: [*a, *b]` (same meaning)."""
    pattern = re.compile(r"^(\s*)<<: (\*\w+)[^\n]*\n\1<<: (\*\w+)([^\n]*)\n", re.MULTILINE)
    return pattern.sub(lambda m: f"{m[1]}<<: [{m[2]}, {m[3]}]{m[4]}\n", text)


def make_yaml() -> YAML:
    yaml = YAML()  # round-trip mode
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)  # closest match to the WireViz examples
    return yaml


def load(text: str):
    return make_yaml().load(text)


def dump(data) -> str:
    out = io.StringIO()
    make_yaml().dump(data, out)
    return out.getvalue()


def changed_lines(a: str, b: str) -> list[str]:
    return [
        line
        for line in difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("+++", "---"))
    ]


def comments(text: str) -> list[str]:
    return [m.group(0).strip() for m in re.finditer(r"#[^\n]*", text)]


def main() -> None:
    original = FIXTURE.read_text(encoding="utf-8")
    try:
        load(original)
        print("1. original loads: yes")
    except Exception as exc:  # noqa: BLE001 - reporting
        reason = next(line for line in str(exc).splitlines() if line.startswith("found"))
        print(f"1. original loads: NO ({type(exc).__name__}: {reason})")

    variant = list_form_variant(original)
    baseline = dump(load(variant))
    print(f"2. list-form variant: {len(changed_lines(original, variant))} lines differ from the original")
    print(f"   comments kept: {sorted(comments(variant)) == sorted(comments(baseline))}")
    print(f"   unchanged dump identical: {baseline == variant} ({len(changed_lines(variant, baseline))} changed lines)")
    for line in changed_lines(variant, baseline):
        print(f"     {line}")

    data = load(variant)
    data["cables"]["W1"]["length"] = 0.25
    edited = dump(data)
    print(f"   one-value edit vs unchanged dump: {len(changed_lines(baseline, edited))} changed lines")
    for line in changed_lines(baseline, edited):
        print(f"     {line}")


if __name__ == "__main__":
    main()
