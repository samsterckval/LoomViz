# M0 spike results

Throwaway scripts that test LoomViz's riskiest assumptions. App code never imports anything from here.

```bash
cd spike
uv sync                                          # Python 3.12 venv with wireviz 0.4.1, ruamel.yaml, pytest
uv run pytest                                    # all checks below as tests
uv run python render.py ../examples/loom/demo02.yml > out/demo02.svg
uv run python bench.py                           # benchmark tables
uv run python roundtrip.py                       # round-trip report
```

## Environment (2026-10-10)

| | |
|---|---|
| Machine | Apple M1, macOS (Darwin 25.6) |
| Python | 3.12.15 (uv-managed) |
| WireViz | 0.4.1 (latest PyPI release, July 2024) |
| ruamel.yaml | 0.19.1 |
| Graphviz | 2.50.0, **x86_64 build running under Rosetta** (`/usr/local/bin/dot`) |

## 1. Rendering through the library ✅

- Entry point: `wireviz.wireviz.parse(yaml_text, return_types="svg", image_paths=[...])`. It accepts a YAML string, a path or a dict.
- **Fully in memory.** With only `return_types` set, no output directory or temp files are needed. Graphviz runs through `graph.pipe()` (stdin/stdout).
- **Images are already inlined.** `Harness.svg` calls `embed_svg_images`, which turns image references into data URIs. Relative image paths resolve against `image_paths`, so the app passes the folder of the file being edited (D14).
- **State leak upstream:** `parse()` has a mutable default `image_paths=[]` and appends to it whenever it reads from a file path. `render.py` always passes a fresh list. Within that rule, renders are independent: A, B, A gives a byte-identical A (`test_no_state_leaks_between_renders`).
- **Warnings are printed, not returned.** For example, unconnected components produce two `print()` lines. `render.py` captures stdout. In the app, this capture must happen inside the worker process.

### Errors

| Kind | What wireviz raises | Line number? |
|---|---|---|
| YAML syntax | `yaml.YAMLError` subclasses with `problem_mark` | **Yes** |
| Unknown pin (`X1: [1, 5]` on a 2-pin connector) | `Exception("X1:5 not found.")` | No |
| Unknown designator | `Exception("X9 is an unknown template/designator/arrow.")` | No |
| Unknown attribute (`colour:`) on a used component | `TypeError("Connector.__init__() got an unexpected keyword argument 'colour'")` | No |
| Top-level list instead of mapping | `TypeError("Expected a dict as top-level YAML input…")` | No |
| Unknown attribute on an **unconnected** component | nothing: only an "unreferenced component" warning | n/a |

For M1: syntax errors map to lines directly. For WireViz errors, the designator or key in the message can be looked up in the YAML (a parser that keeps positions) to find a line, with "no line" as the fallback.

## 2. Render time ⚠️ (dominated by Graphviz start-up)

`uv run python bench.py`: 7 warm runs after 1 warm-up, 5 cold runs, medians in ms. Synthetic harnesses are a chain of labelled 4-pin connectors joined by 4-wire cables.

Warm (same process, what the app's worker pool sees):

| Harness | Connectors | parse | graph | dot | embed | **total** | min–max total |
|---|---:|---:|---:|---:|---:|---:|---:|
| demo02 (real) | 5 | 3 | 1 | 126 | 0 | **130** | 127–143 |
| synthetic-5 | 5 | 3 | 1 | 127 | 0 | **130** | 126–140 |
| synthetic-20 | 20 | 10 | 2 | 148 | 0 | **163** | 158–167 |
| synthetic-60 | 60 | 31 | 7 | 214 | 1 | **253** | 250–274 |

Cold (fresh Python process per render):

| Harness | import wireviz | first render | whole process |
|---|---:|---:|---:|
| demo02 (real) | 35 | 143 | 200 |
| synthetic-5 | 37 | 148 | 213 |
| synthetic-20 | 38 | 196 | 261 |
| synthetic-60 | 37 | 289 | 349 |

Findings:
- **Target met with a wide margin:** 20 connectors render in ~165 ms warm, against SPEC §9's "under 1 s end to end". Even 60 connectors take ~250 ms.
- **Graphviz start-up is most of it:** `dot -Tsvg` on an empty graph takes **119 ms** here. Actual layout work is only ~7 ms (5 connectors), ~29 ms (20) and ~95 ms (60). This machine's `dot` is an old x86_64 build under Rosetta, so a native build (as in the Docker image, M0.8) should be much faster. Re-measure there.
- **YAML parsing and harness building are cheap** (3–31 ms), and image embedding is negligible.
- **Warm workers are worth it but not essential:** a cold process adds ~35 ms import plus ~30 ms interpreter start. Keeping workers alive (as planned) saves ~70 ms per render.
- Not measured yet: the M1 debounce (400 ms) plus HTTP. With these render times, the ~1 s end-to-end target leaves plenty of room.

## 3. ruamel.yaml round trip ❌ for writing files, ✅ for reading meaning

`uv run python roundtrip.py`, tests in `tests/test_roundtrip.py`.

1. **ruamel refuses the upstream demo file.** `demo02.yml` gives connectors X2 and X3 two `<<` merge keys each. ruamel raises `DuplicateKeyError: found duplicate merge key "<<"`, even with `allow_duplicate_keys = True`. PyYAML, which wireviz uses, accepts it. Strict YAML forbids duplicate keys (the spec form is `<<: [*a, *b]`), but the official WireViz examples use the repeated form, so users' files will too.
2. **On the equivalent list-form variant** (`<<: [*molex_f, *con_i2c]`, same rendered diagram, 6 lines changed):
   - ✅ **All comments kept** (text of every comment present after load + dump).
   - ✅ **Meaning kept**: the dumped YAML renders a byte-identical SVG.
   - ✅ **A one-value edit is minimal relative to the unchanged dump**: changing `W1.length` from 0.2 to 0.25 changes exactly that line.
   - ❌ **The unchanged dump is not identical to the source: 31 changed lines.** Even with the best indent setting (`mapping=2, sequence=4, offset=2`):
     - the nested connection lists, written as a bare `-` followed by the items on the next lines (the style of every WireViz example), are rewritten as `-   - X1: …`, which touches every connection set;
     - flow lists gain spaces: `[1,5-7]` → `[1, 5-7]`;
     - an inline comment after a `<<: *alias` moves to its own line.

**Consequence:** a back-end that writes form edits through ruamel would produce noisy diffs on the first save of nearly every real WireViz file, and could not open files using repeated merge keys at all. This supports D7 (form edits happen in the browser, not through ruamel), but only if the `yaml` npm package does better on both points. M0.6 must test exactly these two cases: repeated `<<` keys, and the bare-`-` nested connection style. ruamel remains usable on the back-end only for read-only work on files it can load, and must not be relied on to open every file.

## Not done yet

- M0.6, TypeScript round trip with the `yaml` npm package. Blocked on this machine: `/usr/local/bin/node` aborts on start, and pnpm isn't installed. Needs a working Node 20+ (e.g. `brew install node pnpm`).
- M0.7 (JSON Schema reconnaissance), M0.8 (read-only container and Docker benchmark), M0.9 (clone and push with a git token), M0.10 (leftover inspection).
