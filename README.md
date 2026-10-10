# LoomViz

A web-based editor for [WireViz](https://github.com/wireviz/WireViz) wiring harness diagrams. Point it at a folder (usually a git repository), edit the harness YAML files in its `loom/` subfolder with a live diagram, and keep using your own git tools to commit and push.

Status: prototype (M2 done). Docker packaging (M3) is written but not yet tested on a real Docker host. See [SPEC.md](SPEC.md) for what LoomViz does and [PLAN.md](PLAN.md) for how it's being built.

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

## Run in Docker (Linux)

Needs Docker with the Compose plugin (`docker compose version`). Nothing else: the image brings Python, WireViz, Graphviz and git.

```bash
scripts/docker.sh ~/my-harnesses              # builds the image the first time, prints the URL
scripts/docker.sh ~/my-harnesses --port 8100  # another host port
scripts/docker.sh ~/my-harnesses --detach     # in the background (URL: docker compose logs loomviz)
```

Or without the script: copy `.env.example` to `.env`, fill in `WORKSPACE`, `LOOMVIZ_UID` and `LOOMVIZ_GID` (from `id -u` and `id -g`), then `docker compose up --build`.

Good to know:
- **Mount the repository root.** Git status needs the `.git` folder inside the mounted folder; a subfolder of a repository, or a git worktree, shows "not a git repository".
- **Files stay yours.** The container runs as your user, so saved files belong to you. With rootless Docker, `scripts/docker.sh` runs it as container root, which maps to you.
- **Only this machine can reach it.** The port is published on `127.0.0.1`, and every request needs the launch token.
- **Edits outside LoomViz not showing up?** Start with `--poll`.
- **SELinux (Fedora, RHEL):** add `--selinux` (relabels the mount).

Check a Docker setup end to end with `scripts/docker-smoke.sh` (PASS/FAIL per check).

## Development

See [CLAUDE.md](CLAUDE.md) for the commands (tests, lint, dev server) and the architecture notes.

License: [GPL-3.0](LICENSE).
