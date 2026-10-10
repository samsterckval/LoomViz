#!/usr/bin/env bash
# Start LoomViz in Docker on a folder: builds the image if needed and prints the launch URL.
#
#   scripts/docker.sh [folder] [--port N] [--lan] [--allow-host NAME] [--tls CERT KEY]
#                     [--poll] [--selinux] [--detach]
#
#   folder           the folder to work on, ideally a git repository root (default: examples/)
#   --port N         host port (default 8000)
#   --lan            also reachable from other machines on the network (default: this machine only)
#   --allow-host N   another host name or IP other machines use (repeatable; implies --lan)
#   --tls CERT KEY   serve HTTPS with this certificate and private key (PEM files)
#   --poll           poll for file changes (if edits made outside LoomViz don't show up)
#   --selinux        label the mount for SELinux (Fedora, RHEL)
#   --detach         run in the background; see the URL with: docker compose logs loomviz
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
lan=0
extra_hosts=""
tls_cert=""
tls_key=""
detach=()

if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  folder="$1"
  shift
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="${2:?--port needs a number}"; shift 2 ;;
    --lan) lan=1; shift ;;
    --allow-host) lan=1; extra_hosts="${extra_hosts:+$extra_hosts,}${2:?--allow-host needs a name}"; shift 2 ;;
    --tls) tls_cert="${2:?--tls needs CERT and KEY}"; tls_key="${3:?--tls needs CERT and KEY}"; shift 3 ;;
    --poll) poll=1; shift ;;
    --selinux) selinux=1; shift ;;
    --detach|-d) detach=(--detach); shift ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

if [ -n "$tls_cert" ]; then
  [ -f "$tls_cert" ] && [ -f "$tls_key" ] || { echo "TLS certificate or key not found" >&2; exit 1; }
  TLS_CERT="$(cd "$(dirname "$tls_cert")" && pwd)/$(basename "$tls_cert")"
  TLS_KEY="$(cd "$(dirname "$tls_key")" && pwd)/$(basename "$tls_key")"
  export TLS_CERT TLS_KEY
  compose_files+=(-f "$repo/compose.tls.yaml")
fi
if [ "$lan" = 1 ]; then
  export BIND_ADDRESS=0.0.0.0
  hosts="$("$repo/scripts/lan-hosts.sh")"
  LOOMVIZ_ALLOWED_HOSTS="$(printf '%s' "${hosts}${extra_hosts:+,$extra_hosts}" | sed 's/^,//')"
  export LOOMVIZ_ALLOWED_HOSTS
  echo "LAN access for: $LOOMVIZ_ALLOWED_HOSTS" >&2
  echo "Note: Docker opens published ports past host firewalls such as ufw." >&2
  [ -z "$tls_cert" ] && echo "Warning: plain HTTP on the network; the launch token travels unencrypted (use --tls)." >&2
else
  export BIND_ADDRESS=127.0.0.1 LOOMVIZ_ALLOWED_HOSTS=""
fi

[ -d "$WORKSPACE/.git" ] || echo "Note: $WORKSPACE is not a git repository root; the header will say so." >&2
echo "LoomViz in Docker on $WORKSPACE (port $PORT, running as $LOOMVIZ_UID:$LOOMVIZ_GID)" >&2

exec docker compose "${compose_files[@]}" --project-directory "$repo" up --build ${detach[@]+"${detach[@]}"}
