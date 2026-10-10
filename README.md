# LoomViz

A web-based editor for [WireViz](https://github.com/wireviz/WireViz) wiring harness diagrams. LoomViz runs as a stateless Docker container: open a git repository, edit the harness YAML files in its `loom/` folder with a live diagram preview, then commit and push. Nothing stays behind in the container.

Status: early prototype (milestone M1). It edits harness files in a local folder with a live preview; opening git repositories, the terminal and Docker come later. See [SPEC.md](SPEC.md) for what LoomViz does and [PLAN.md](PLAN.md) for how it's being built.

## Try it

Needs [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io) and [Graphviz](https://graphviz.org) (`brew install uv pnpm graphviz`).

```bash
scripts/dev.sh                  # opens the sample harness in examples/loom/
scripts/dev.sh ~/my-harnesses   # or any folder that has a loom/ subfolder
```

Open the URL it prints (it contains a one-time launch token). Edit the YAML on the left; the diagram on the right updates as you type. Save with Ctrl/Cmd+S. Stop with Ctrl+C.

License: [GPL-3.0](LICENSE).
