#!/usr/bin/env bash
# Start LoomViz in Docker on a folder: builds the image if needed and prints the launch URL.
#
#   scripts/docker.sh [folder] [--port N] [--poll] [--selinux] [--detach]
#
#   folder      the folder to work on, ideally a git repository root (default: examples/)
#   --port N    host port (default 8000); LoomViz is only reachable on 127.0.0.1
#   --poll      poll for file changes (if edits made outside LoomViz don't show up)
#   --selinux   label the mount for SELinux (Fedora, RHEL)
#   --detach    run in the background; see the URL with: docker compose logs loomviz
#
# Needs Docker with the Compose plugin (docker compose version). Stop with Ctrl+C, or
# `docker compose down` when detached.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
folder="$repo/examples"
port=8000
poll=0
compose_files=(-f "$repo/compose.yaml")
selinux=0
detach=()

if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  folder="$1"
  shift
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="${2:?--port needs a number}"; shift 2 ;;
    --poll) poll=1; shift ;;
    --selinux) selinux=1; shift ;;
    --detach|-d) detach=(--detach); shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The Docker Compose plugin is missing ('docker compose')." >&2; exit 1; }
[ -d "$folder" ] || { echo "Not a folder: $folder" >&2; exit 1; }
case "$port" in ''|*[!0-9]*) echo "--port needs a number" >&2; exit 2 ;; esac

uid="$(id -u)"
gid="$(id -g)"
# Rootless Docker maps container root to you; your own uid would map to someone else.
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  uid=0
  gid=0
fi
if [ "$selinux" = 1 ]; then
  compose_files+=(-f "$repo/compose.selinux.yaml")
elif command -v selinuxenabled >/dev/null && selinuxenabled; then
  echo "Note: SELinux is enabled; if LoomViz can't read the folder, run again with --selinux." >&2
fi

WORKSPACE="$(cd "$folder" && pwd)"
export WORKSPACE
export PORT="$port"
export LOOMVIZ_UID="$uid"
export LOOMVIZ_GID="$gid"
export LOOMVIZ_POLL="$poll"

[ -d "$WORKSPACE/.git" ] || echo "Note: $WORKSPACE is not a git repository root; the header will say so." >&2
echo "LoomViz in Docker on $WORKSPACE (port $PORT, running as $LOOMVIZ_UID:$LOOMVIZ_GID)" >&2

exec docker compose "${compose_files[@]}" --project-directory "$repo" up --build ${detach[@]+"${detach[@]}"}
