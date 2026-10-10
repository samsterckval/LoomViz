# LoomViz

A web-based editor for [WireViz](https://github.com/wireviz/WireViz) wiring harness diagrams. Point it at a folder (usually a git repository), edit the harness YAML files in its `loom/` subfolder with a live diagram, and keep using your own git tools to commit and push.

Status: v0.1 candidate: runs natively (macOS, Linux) and in Docker (tested on Linux), locally or on your network. See [SPEC.md](SPEC.md) for what LoomViz does and [PLAN.md](PLAN.md) for how it's being built.

## Try it

Needs [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io), [Graphviz](https://graphviz.org) and, for PDF export, Pango (`brew install uv pnpm graphviz pango`).

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
- **Options:** click **⚙ Options** above the editor for a form with WireViz's harness-wide `options:` (background colours, colour names, font, mini BOM mode, template separator). The form edits the YAML directly, changing only those lines; ↺ removes a setting so WireViz's default applies, and Cmd/Ctrl+Z in the editor undoes a form edit.
- **Document view:** WireViz's own page with the BOM and, if the harness asks for one, a drawing frame (e.g. DIN 6771). Tick **BOM on a separate sheet** for a drawing sheet plus a BOM sheet ("1 of 2", "2 of 2"), and **Download PDF** to save it at the template's paper size (e.g. A3 landscape). PDF export uses WeasyPrint, which needs Pango: included in Docker; natively on macOS `brew install pango`.
- **Rendering:** click **Render** (or Ctrl/Cmd+Enter) after editing; tick **Auto** to render as you type.
- **Files:** a tree of `loom/` with new, rename and delete. Unsaved edits are marked ● and survive a page reload; Ctrl/Cmd+S saves.
- **Works alongside git:** the header shows the branch and how many harness files have uncommitted changes. Files changed on disk (by `git pull`, a branch switch or another editor) reload automatically; if you have unsaved edits, you choose which version to keep. LoomViz itself never runs a git command that changes anything.

LoomViz listens on `127.0.0.1` only by default, every request needs the launch token, and it only reads and writes files inside `loom/`.

## Open it from another machine (LAN)

```bash
scripts/dev.sh ~/my-harnesses --lan                                 # plain HTTP
scripts/dev.sh ~/my-harnesses --lan --tls-cert box.pem --tls-key box-key.pem   # HTTPS
```

It prints a URL for each name and address this machine has on the network (e.g. `http://my-box.local:8000/?token=…`, `http://192.168.1.20:8000/?token=…`); open one of them on the other machine. Add names it didn't detect with `--allow-host NAME`. Requests addressed to any other name are refused, and the launch token is still required.

- **Plain HTTP sends the launch token unencrypted** over your network. Fine on a network you trust (home); otherwise use HTTPS. [mkcert](https://github.com/FiloSottile/mkcert) makes a certificate your browsers trust: `mkcert my-box.local 192.168.1.20`.
- **Alternative without LAN mode:** an SSH tunnel from the other machine, `ssh -L 8000:127.0.0.1:8000 you@my-box`, then open `http://127.0.0.1:8000/?token=…` there.

## Run it as a server on your network (Linux, Docker)

One command, on the machine that has your harness repository:

```bash
scripts/docker.sh ~/my-harness-repo --serve                        # plain HTTP
scripts/docker.sh ~/my-harness-repo --serve --tls box.pem box-key.pem   # HTTPS
```

It builds the image the first time, starts LoomViz in the background, checks that it answers on the network, and prints the URLs to open on your other computers, e.g. `http://192.168.1.20:8000/?token=…`. It restarts by itself, also after a reboot, and keeps the same URLs, so you can bookmark one.

```bash
scripts/docker.sh --url     # show the URLs again, and whether it's running
scripts/docker.sh --stop    # stop it (start again with the same --serve command; the URLs stay the same)
```

The token is kept in `~/.local/state/loomviz/token` (readable only by you). Delete that file to get a new token, and so new URLs, on the next `--serve`.

**Can't connect from the other computer?**
1. **Use the IP URL first** (the `http://192.168.…` one). Names like `my-box.local` need mDNS: on Linux that's the `avahi-daemon` service, and not every network or OS resolves them.
2. **Same network?** From the other computer, `ping 192.168.1.20` (the server's address) should answer. Guest Wi-Fi and some routers isolate devices from each other.
3. **Does the page load without the token?** Open `http://192.168.1.20:8000/`: you should see LoomViz asking for its URL. If you do, the network is fine; copy the full URL with `?token=…` from `--url`.
4. **Firewall.** Docker opens published ports past ufw, but other firewalls (firewalld, a cloud security group, a router between subnets) can still block the port.
5. **The server's address changed** (DHCP): run `--serve` again so LoomViz accepts the new address, or give the machine a fixed address in your router. Requests addressed to an IP or name LoomViz doesn't know get "Host not allowed".
6. **No Docker on hand?** An SSH tunnel works too: `ssh -L 8000:127.0.0.1:8000 you@my-box`, then open `http://127.0.0.1:8000/?token=…` on your own computer.

Plain HTTP sends the token unencrypted on your network: fine at home, otherwise use `--tls` (see [mkcert](https://github.com/FiloSottile/mkcert) for a certificate your browsers trust).

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
- **Only this machine can reach it**, unless you add `--lan` (and `--tls CERT KEY` for HTTPS): `scripts/docker.sh ~/my-harnesses --lan --tls box.pem box-key.pem`. Note that Docker opens published ports past host firewalls such as ufw.
- **Edits outside LoomViz not showing up?** Start with `--poll`.
- **SELinux (Fedora, RHEL):** add `--selinux` (relabels the mount).

Check a Docker setup end to end with `scripts/docker-smoke.sh` (PASS/FAIL per check).

## Development

See [CLAUDE.md](CLAUDE.md) for the commands (tests, lint, dev server) and the architecture notes.

License: [GPL-3.0](LICENSE).
