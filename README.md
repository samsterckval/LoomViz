# LoomViz

A web-based editor for [WireViz](https://github.com/wireviz/WireViz) wiring harness diagrams. Point it at a folder (usually a git repository), edit the harness YAML files in its `loom/` subfolder with a live diagram, and keep using your own git tools to commit and push.

Status: prototype (milestone M2 done; Docker packaging is next). See [SPEC.md](SPEC.md) for what LoomViz does and [PLAN.md](PLAN.md) for how it's being built.

## Try it

Needs [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io) and [Graphviz](https://graphviz.org) (`brew install uv pnpm graphviz`).

```bash
scripts/dev.sh                  # the sample harness in examples/loom/
scripts/dev.sh ~/my-harnesses   # any folder; harness files live in its loom/ subfolder
scripts/dev.sh ~/my-harnesses --port 8100
```

Open the URL it prints (it contains a launch token). Stop with Ctrl+C.

What you get:
- **Editor:** Monaco with YAML highlighting; render errors are marked at their line.
- **Live diagram:** updates as you type; zoom with the wheel, drag to pan, **Fit** to reset.
- **Diagram ↔ YAML:** click a connector, cable or wire to jump to its YAML and see its details; put the cursor on a component in the YAML to highlight it in the diagram.
- **Document view:** WireViz's own page with the BOM and, if the harness asks for one, a drawing frame (e.g. DIN 6771).
- **Files:** a tree of `loom/` with new, rename and delete. Unsaved edits are marked ● and survive a page reload; Ctrl/Cmd+S saves.
- **Works alongside git:** the header shows the branch and how many harness files have uncommitted changes. Files changed on disk (by `git pull`, a branch switch or another editor) reload automatically; if you have unsaved edits, you choose which version to keep. LoomViz itself never runs a git command that changes anything.

LoomViz only listens on `127.0.0.1`, every request needs the launch token, and it only reads and writes files inside `loom/`.

## Development

See [CLAUDE.md](CLAUDE.md) for the commands (tests, lint, dev server) and the architecture notes.

License: [GPL-3.0](LICENSE).
