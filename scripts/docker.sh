#!/usr/bin/env bash
# Run LoomViz in Docker on a folder.
#
# Usage:
#   scripts/docker.sh <folder> --serve [options]   server mode: in the background, reachable from
#                                                  other computers, restarts after reboots
#   scripts/docker.sh --url                        show the server's URLs (and whether it's running)
#   scripts/docker.sh --stop                       stop the server
#   scripts/docker.sh [folder] [options]           interactive: in this terminal until Ctrl+C
#
# Modes:
#   --serve          server mode (SPEC FR-36): implies --lan and runs in the background; keeps
#                    the same URL across restarts, checks it answers on the network and prints
#                    the URLs to open on other computers
#   --url            print the server's URLs again (alias: --status)
#   --stop           stop the server; its URL/token is kept for the next --serve
#
# Options:
#   folder           the folder to work on, ideally a git repository root (default: examples/)
#   --port N         host port (default 8000)
#   --lan            also reachable from other computers (default: this machine only)
#   --allow-host N   another host name or IP other computers use (repeatable; implies --lan)
#   --tls CERT KEY   serve HTTPS with this certificate and private key (PEM files)
#   --poll           poll for file changes (if edits made outside LoomViz don't show up)
#   --selinux        label the mount for SELinux (Fedora, RHEL)
#   --detach         interactive mode only: run in the background (URL: docker compose logs loomviz)
#   -h, --help       show this help
#
# Needs Docker with the Compose plugin (docker compose version).
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/loomviz"
state_file="$state_dir/server.env"
token_file="$state_dir/token"

folder="$repo/examples"
port=8000
poll=0
selinux=0
lan=0
extra_hosts=""
tls_cert=""
tls_key=""
detach=0
mode=interactive  # interactive | serve | url | stop

usage() { sed -n '2,/^[^#]/p' "$0" | sed -e '$d' -e '/^# shellcheck/d' -e 's/^# \{0,1\}//'; }

if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  folder="$1"
  shift
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --serve) mode=serve; shift ;;
    --url|--status) mode=url; shift ;;
    --stop) mode=stop; shift ;;
    --port) port="${2:?--port needs a number}"; shift 2 ;;
    --lan) lan=1; shift ;;
    --allow-host) lan=1; extra_hosts="${extra_hosts:+$extra_hosts,}${2:?--allow-host needs a name}"; shift 2 ;;
    --tls) tls_cert="${2:?--tls needs CERT and KEY}"; tls_key="${3:?--tls needs CERT and KEY}"; shift 3 ;;
    --poll) poll=1; shift ;;
    --selinux) selinux=1; shift ;;
    --detach|-d) detach=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The Docker Compose plugin is missing ('docker compose')." >&2; exit 1; }

# --- helpers -------------------------------------------------------------------------------------

files=(compose.yaml)  # compose files in use (names relative to the repository)

server_compose() { # server_compose <compose arguments...>: the --serve project with the files in use
  local file_args=()
  for file in "${files[@]}"; do file_args+=(-f "$repo/$file"); done
  docker compose "${file_args[@]}" --project-directory "$repo" -p loomviz-server "$@"
}

print_urls() { # print_urls <scheme> <port> <token> <comma-separated hosts>
  local scheme="$1" port="$2" token="$3" hosts="$4" host
  # IP addresses first: they work without name resolution on the other computer.
  for host in $(printf '%s' "$hosts" | tr ',' '\n' | sort -t. -k1,1 -n -r); do
    case "$host" in *:*) host="[$host]" ;; esac  # IPv6 literal
    echo "  $scheme://$host:$port/?token=$token"
  done
}

ipv4_hosts() { printf '%s' "$1" | tr ',' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' || true; }

# --- --url and --stop: use the settings saved by --serve ------------------------------------------

if [ "$mode" = url ] || [ "$mode" = stop ]; then
  [ -f "$state_file" ] || { echo "No LoomViz server has been started with --serve on this machine." >&2; exit 1; }
  # shellcheck source=/dev/null
  . "$state_file"
  SCHEME="${SCHEME:-http}"  # saved by --serve
  export WORKSPACE PORT LOOMVIZ_UID LOOMVIZ_GID LOOMVIZ_POLL LOOMVIZ_TOKEN LOOMVIZ_ALLOWED_HOSTS BIND_ADDRESS
  export RESTART_POLICY TLS_CERT TLS_KEY
  read -r -a files <<<"$COMPOSE_FILES"
  if [ "$mode" = stop ]; then
    server_compose down --timeout 10
    echo "Stopped. 'scripts/docker.sh $WORKSPACE --serve' starts it again with the same URL."
    exit 0
  fi
  if [ -n "$(server_compose ps --status running -q 2>/dev/null)" ]; then
    echo "LoomViz is running on $WORKSPACE. Open from another computer:"
  else
    echo "LoomViz is NOT running (start it with: scripts/docker.sh $WORKSPACE --serve). Its URLs:"
  fi
  print_urls "$SCHEME" "$PORT" "$LOOMVIZ_TOKEN" "$LOOMVIZ_ALLOWED_HOSTS"
  echo "On this machine: $SCHEME://127.0.0.1:$PORT/?token=$LOOMVIZ_TOKEN"
  exit 0
fi

# --- interactive and server mode ------------------------------------------------------------------

[ -d "$folder" ] || { echo "Not a folder: $folder" >&2; exit 1; }
case "$port" in ''|*[!0-9]*) echo "--port needs a number" >&2; exit 2 ;; esac
[ "$mode" = serve ] && lan=1 && detach=1

uid="$(id -u)"
gid="$(id -g)"
# Rootless Docker maps container root to you; your own uid would map to someone else.
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  uid=0
  gid=0
fi

if [ "$selinux" = 1 ]; then
  files+=(compose.selinux.yaml)
elif command -v selinuxenabled >/dev/null && selinuxenabled; then
  echo "Note: SELinux is enabled; if LoomViz can't read the folder, run again with --selinux." >&2
fi

WORKSPACE="$(cd "$folder" && pwd)"
export WORKSPACE
export PORT="$port"
export LOOMVIZ_UID="$uid"
export LOOMVIZ_GID="$gid"
export LOOMVIZ_POLL="$poll"
export RESTART_POLICY=no
export TLS_CERT="" TLS_KEY=""
scheme=http

if [ -n "$tls_cert" ]; then
  [ -f "$tls_cert" ] && [ -f "$tls_key" ] || { echo "TLS certificate or key not found" >&2; exit 1; }
  TLS_CERT="$(cd "$(dirname "$tls_cert")" && pwd)/$(basename "$tls_cert")"
  TLS_KEY="$(cd "$(dirname "$tls_key")" && pwd)/$(basename "$tls_key")"
  files+=(compose.tls.yaml)
  scheme=https
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

if [ "$mode" = interactive ]; then
  echo "LoomViz in Docker on $WORKSPACE (port $PORT, running as $LOOMVIZ_UID:$LOOMVIZ_GID)" >&2
  up_args=(up --build)
  [ "$detach" = 1 ] && up_args+=(--detach)
  file_args=()
  for f in "${files[@]}"; do file_args+=(-f "$repo/$f"); done
  exec docker compose "${file_args[@]}" --project-directory "$repo" "${up_args[@]}"
fi

# --- server mode -----------------------------------------------------------------------------------

mkdir -p "$state_dir"
chmod 700 "$state_dir"
if [ -z "${LOOMVIZ_TOKEN:-}" ]; then
  if [ ! -s "$token_file" ]; then
    (umask 077 && head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$token_file")
  fi
  LOOMVIZ_TOKEN="$(cat "$token_file")"
fi
export LOOMVIZ_TOKEN
export RESTART_POLICY=unless-stopped

# Save the settings so --url and --stop work later without repeating the options.
(
  umask 077
  {
    for var in WORKSPACE PORT LOOMVIZ_UID LOOMVIZ_GID LOOMVIZ_POLL LOOMVIZ_TOKEN LOOMVIZ_ALLOWED_HOSTS \
      BIND_ADDRESS RESTART_POLICY TLS_CERT TLS_KEY; do
      printf '%s=%q\n' "$var" "${!var}"
    done
    printf 'SCHEME=%q\n' "$scheme"
    printf 'COMPOSE_FILES=%q\n' "${files[*]}"
  } >"$state_file"
)

echo "Starting LoomViz in the background on $WORKSPACE (port $PORT, running as $LOOMVIZ_UID:$LOOMVIZ_GID)…"
up=(up --detach --build)
server_compose up --help 2>/dev/null | grep -q -- '--wait' && up+=(--wait)
if ! server_compose "${up[@]}"; then
  echo "Starting failed. Logs: docker compose -p loomviz-server logs" >&2
  exit 1
fi

curl_opts=(-s -o /dev/null -w '%{http_code}' --max-time 5)
[ "$scheme" = https ] && curl_opts+=(-k)  # we only check that it answers; the browser checks the certificate
for _ in $(seq 1 30); do
  [ "$(curl "${curl_opts[@]}" "$scheme://127.0.0.1:$PORT/")" = 200 ] && break
  sleep 1
done

# Prove it answers on the network address, not just on 127.0.0.1.
reachable=""
for ip in $(ipv4_hosts "$LOOMVIZ_ALLOWED_HOSTS"); do
  if [ "$(curl "${curl_opts[@]}" "$scheme://$ip:$PORT/")" = 200 ]; then
    reachable="$ip"
    break
  fi
done

echo
if [ -n "$reachable" ]; then
  echo "LoomViz is running and answers on the network ($reachable:$PORT)."
else
  echo "LoomViz is running, but it did not answer on this machine's network address."
  echo "Check: 'docker compose -p loomviz-server ps' and 'docker compose -p loomviz-server logs'."
fi
echo "Open from another computer:"
print_urls "$scheme" "$PORT" "$LOOMVIZ_TOKEN" "$LOOMVIZ_ALLOWED_HOSTS"
echo "On this machine: $scheme://127.0.0.1:$PORT/?token=$LOOMVIZ_TOKEN"
echo
echo "It restarts automatically (also after a reboot) and keeps these URLs."
echo "Show them again: scripts/docker.sh --url    Stop: scripts/docker.sh --stop"
echo "Can't connect from the other computer? See 'Run it as a server on your network' in README.md."
