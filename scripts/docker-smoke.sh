#!/usr/bin/env bash
# End-to-end check of LoomViz in Docker (PLAN M3.5). Builds the image, starts it on a temporary
# git repository copied from examples/, and prints PASS/FAIL per check. Cleans up afterwards.
#
#   scripts/docker-smoke.sh [--lan] [--tls] [--poll] [--selinux] [--keep] [--native]
#
#   --lan       LAN mode (FR-35): also checks access via this machine's LAN address
#   --tls       HTTPS with a throwaway self-signed certificate (needs openssl)
#   --poll      start with LOOMVIZ_POLL=1 (if the live-reload check fails without it)
#   --selinux   add compose.selinux.yaml (Fedora, RHEL)
#   --keep      leave the container and temp folder running for a look (prints how to stop)
#   --native    for working on this script without Docker: run the same checks against a local
#               `uv run loomviz` (container-only checks are skipped)
#
# Needs: docker with the compose plugin, curl, git, python3. Optional: node + Chrome/Chromium
# for the UI check (scripts/ui-smoke.mjs); skipped otherwise. Exit code 1 if any check fails.
# shellcheck disable=SC2015  # "test && pass || fail" is fine here: pass never fails
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
poll=0
keep=0
native=0
lan=0
tls=0
compose_files=(-f "$repo/compose.yaml")
while [ $# -gt 0 ]; do
  case "$1" in
    --poll) poll=1 ;;
    --selinux) compose_files+=(-f "$repo/compose.selinux.yaml") ;;
    --keep) keep=1 ;;
    --native) native=1 ;;
    --lan) lan=1 ;;
    --tls) tls=1 ;;
    -h|--help) sed -n '2,/^[^#]/p' "$0" | sed -e '$d' -e '/^# shellcheck/d' -e 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ "$tls" = 1 ] && ! command -v openssl >/dev/null && { echo "--tls needs openssl" >&2; exit 2; }
for tool in curl git python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 2; }
done
if [ "$native" = 0 ]; then
  command -v docker >/dev/null || { echo "Missing docker" >&2; exit 2; }
  docker compose version >/dev/null 2>&1 || { echo "Missing the Docker Compose plugin" >&2; exit 2; }
fi

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s%s\n' "$1" "${2:+  ($2)}"; failures=$((failures + 1)); }
skip() { printf 'SKIP  %s%s\n' "$1" "${2:+  ($2)}"; }
check() { # check "name" command...   (PASS if the command succeeds)
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}

# --- set-up --------------------------------------------------------------------------------------

tmp_root="${TMPDIR:-/tmp}"
workspace="$(mktemp -d "${tmp_root%/}/loomviz-smoke.XXXXXX")"
cp -R "$repo/examples/loom" "$workspace/loom"
git -C "$workspace" -c init.defaultBranch=main init -q
git -C "$workspace" add .
git -C "$workspace" -c user.name=smoke -c user.email=smoke@example.com commit -qm "smoke test fixture"

port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
token="smoke-$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
uid="$(id -u)"
gid="$(id -g)"
if [ "$native" = 0 ] && docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  uid=0  # rootless Docker: container root maps to the current user
  gid=0
fi
export WORKSPACE="$workspace" PORT="$port" LOOMVIZ_UID="$uid" LOOMVIZ_GID="$gid" LOOMVIZ_TOKEN="$token" LOOMVIZ_POLL="$poll"

scheme=http
native_args=()
curl_tls=()
secrets_dir="$(mktemp -d "${tmp_root%/}/loomviz-smoke-tls.XXXXXX")"
if [ "$tls" = 1 ]; then
  scheme=https
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=loomviz-smoke" \
    -keyout "$secrets_dir/key.pem" -out "$secrets_dir/cert.pem" >/dev/null 2>&1
  export TLS_CERT="$secrets_dir/cert.pem" TLS_KEY="$secrets_dir/key.pem"
  compose_files+=(-f "$repo/compose.tls.yaml")
  native_args+=(--tls-cert "$TLS_CERT" --tls-key "$TLS_KEY")
  curl_tls=(-k)  # self-signed
fi
lan_ip=""
if [ "$lan" = 1 ]; then
  LOOMVIZ_ALLOWED_HOSTS="$("$repo/scripts/lan-hosts.sh")"
  export BIND_ADDRESS=0.0.0.0 LOOMVIZ_ALLOWED_HOSTS
  native_args+=(--lan)
  lan_ip="$(printf '%s' "$LOOMVIZ_ALLOWED_HOSTS" | tr ',' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -1)"
else
  export BIND_ADDRESS=127.0.0.1 LOOMVIZ_ALLOWED_HOSTS=""
fi
# Every curl below talks to LoomViz; accept the self-signed certificate in --tls mode.
curl() { command curl ${curl_tls[@]+"${curl_tls[@]}"} "$@"; }
compose=(docker compose "${compose_files[@]}" --project-directory "$repo" -p loomviz-smoke)

native_pid=""
cleanup() {
  if [ "$keep" = 1 ]; then
    echo
    echo "Kept running: http://127.0.0.1:$port/?token=$token"
    if [ "$native" = 1 ]; then
      echo "Stop with:   kill $native_pid; rm -rf '$workspace'"
    else
      echo "Stop with:   WORKSPACE='$workspace' docker compose -f '$repo/compose.yaml' -p loomviz-smoke down; rm -rf '$workspace'"
    fi
    return
  fi
  if [ "$native" = 1 ]; then
    [ -n "$native_pid" ] && kill "$native_pid" 2>/dev/null
  else
    "${compose[@]}" down --timeout 5 >/dev/null 2>&1
  fi
  rm -rf "$workspace" "$secrets_dir"
}
trap cleanup EXIT

if [ "$native" = 1 ]; then
  echo "Starting natively (workspace $workspace, port $port)…"
  (cd "$repo/backend" && exec uv run loomviz "$workspace" --port "$port" ${native_args[@]+"${native_args[@]}"}) >/dev/null 2>&1 &
  native_pid=$!
else
  echo "Building and starting (workspace $workspace, port $port, user $uid:$gid, poll=$poll)…"
  if ! "${compose[@]}" build --quiet; then
    fail "image builds"
    exit 1
  fi
  pass "image builds"
  # --wait (compose >= 2.1) waits for the healthcheck; the loop below covers older versions too.
  if "${compose[@]}" up --help 2>/dev/null | grep -q -- '--wait'; then
    "${compose[@]}" up --detach --wait >/dev/null 2>&1 || true
  else
    "${compose[@]}" up --detach >/dev/null 2>&1 || true
  fi
fi
base="$scheme://127.0.0.1:$port"
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "$base/" && break
  sleep 1
done

auth=(-H "Authorization: Bearer $token")
api() { curl -s "${auth[@]}" "$@"; }
status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# Run a command where LoomViz runs: in the container, or (with --native) with the back-end's venv.
in_container() {
  if [ "$native" = 1 ]; then
    (cd "$repo/backend" && uv run "$@")
  else
    "${compose[@]}" exec -T loomviz "$@"
  fi
}
container_id() { "${compose[@]}" ps -q loomviz; }
is_healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$(container_id)")" = healthy ]; }
published_on() { [ "$("${compose[@]}" port loomviz 8000)" = "$1:$port" ]; }
logs_show_url() { "${compose[@]}" logs loomviz | grep -qF "Open: $scheme://127.0.0.1:$port/?token="; }
logs_show_lan_url() { "${compose[@]}" logs loomviz | grep -qF "or: $scheme://$lan_ip:$port/?token="; }
runs_as_uid() { [ "$(in_container id -u | tr -d '\r')" = "$uid" ]; }
root_read_only() { ! in_container sh -c 'touch /probe' 2>/dev/null; }
has_tools() { in_container sh -c 'dot -V && git --version'; }

# --- container -----------------------------------------------------------------------------------

if [ "$native" = 1 ]; then
  skip "container checks" "--native"
else
  check "container is healthy" is_healthy
  if [ "$lan" = 1 ]; then
    check "port published on all interfaces (LAN mode)" published_on 0.0.0.0
  else
    check "port published on 127.0.0.1 only" published_on 127.0.0.1
  fi
  check "launch URL in the logs uses the host port" logs_show_url
  [ -n "$lan_ip" ] && check "logs also show the LAN URL" logs_show_lan_url
  check "runs as $uid:$gid" runs_as_uid
  check "root filesystem is read-only" root_read_only
  check "Graphviz and git in the image" has_tools
fi

# --- security ------------------------------------------------------------------------------------

with_token="$(status_of "${auth[@]}" "$base/api/session")"
[ "$with_token" = 200 ] && pass "API with the launch token: 200" || fail "API with the launch token: 200" "got $with_token"
without_token="$(status_of "$base/api/session")"
[ "$without_token" = 401 ] && pass "API without the token: 401" || fail "API without the token: 401" "got $without_token"
foreign="$(status_of "${auth[@]}" -H "Host: 192.168.1.10:$port" "$base/api/session")"
[ "$foreign" = 403 ] && pass "foreign Host header: 403" || fail "foreign Host header: 403" "got $foreign"
origin="$(status_of "${auth[@]}" -H "Origin: https://evil.example" "$base/api/session")"
[ "$origin" = 403 ] && pass "foreign Origin: 403" || fail "foreign Origin: 403" "got $origin"

# --- LAN access (FR-35) --------------------------------------------------------------------------

if [ "$lan" = 1 ]; then
  if [ -z "$lan_ip" ]; then
    skip "LAN access checks" "no IPv4 LAN address found"
  else
    via_lan="$(status_of "${auth[@]}" "$scheme://$lan_ip:$port/api/session")"
    [ "$via_lan" = 200 ] && pass "reachable via the LAN address $lan_ip" || fail "reachable via the LAN address $lan_ip" "got $via_lan"
    made_up="$(status_of "${auth[@]}" -H "Host: not-this-box.example:$port" "$scheme://$lan_ip:$port/api/session")"
    [ "$made_up" = 403 ] && pass "LAN: a made-up Host header still gets 403" || fail "LAN: a made-up Host header still gets 403" "got $made_up"
  fi
fi
if [ "$tls" = 1 ]; then
  plain="$(command curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/session")"
  [ "$plain" != 200 ] && pass "TLS: plain HTTP isn't served" || fail "TLS: plain HTTP isn't served" "got $plain"
fi

# --- workspace, git, rendering -------------------------------------------------------------------

api "$base/api/files" | grep -q '"demo02.yml"' && pass "lists loom/demo02.yml" || fail "lists loom/demo02.yml"
git_status="$(api "$base/api/git/status")"
if echo "$git_status" | grep -q '"repository":true' && echo "$git_status" | grep -q '"branch":"main"'; then
  pass "git status in the container (branch main)"
else
  fail "git status in the container (branch main)" "$git_status"
fi

body="$(python3 -c 'import json, sys; print(json.dumps({"yaml": open(sys.argv[1]).read(), "path": "demo02.yml", "html": True}))' "$workspace/loom/demo02.yml")"
render="$(api -H 'Content-Type: application/json' -d "$body" "$base/api/render")"
echo "$render" | grep -q 'wire&#45;W1&#45;3&#45;a' && pass "renders demo02 with wire ids" || fail "renders demo02 with wire ids" "${render:0:200}"
echo "$render" | grep -q 'class=\\"bom\\"' && pass "document view (BOM table)" || fail "document view (BOM table)"
echo "$render" | grep -q 'id=\\"frame\\" class=\\"A3\\"' && pass "document view (din-6771 frame)" || fail "document view (din-6771 frame)"

# --- writing into the mounted folder -------------------------------------------------------------

created="$(status_of "${auth[@]}" -X PUT -H 'If-None-Match: *' --data-binary $'connectors:\n  X1: {pincount: 2}\n' "$base/api/files/smoke.yml")"
[ "$created" = 204 ] && pass "creates a file through the API" || fail "creates a file through the API" "got $created"
if [ -f "$workspace/loom/smoke.yml" ]; then
  owner="$(stat -c %u "$workspace/loom/smoke.yml" 2>/dev/null || stat -f %u "$workspace/loom/smoke.yml")"
  [ "$owner" = "$(id -u)" ] && pass "the file belongs to you (uid $owner)" || fail "the file belongs to you" "owned by uid $owner, you are $(id -u)"
else
  fail "the file appears in the folder on the host"
fi
leftovers="$(find "$workspace/loom" -name '.loomviz-tmp-*' | wc -l | tr -d ' ')"
[ "$leftovers" = 0 ] && pass "no temp files left behind" || fail "no temp files left behind" "$leftovers found"
api "$base/api/git/status" | grep -q '"path":"smoke.yml","status":"untracked"' && pass "git status sees the new file" || fail "git status sees the new file"

# --- live reload: an edit on the host reaches /ws/events -----------------------------------------
# The WebSocket client runs inside the container (which has Python websockets). It connects to
# the internal port 8000 but performs the handshake for 127.0.0.1:$PORT, as a browser would.

events="$(mktemp)"
in_container python - "$port" "$token" "$( [ "$native" = 1 ] && echo "$port" || echo 8000 )" "$scheme" >"$events" 2>&1 <<'PY' &
import json, socket, ssl, sys
from websockets.sync.client import connect
port, token, internal_port, scheme = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
sock = socket.create_connection(("127.0.0.1", internal_port), timeout=5)
tls = None
if scheme == "https":
    tls = ssl.create_default_context()
    tls.check_hostname = False
    tls.verify_mode = ssl.CERT_NONE  # the smoke test's throwaway self-signed certificate
ws_scheme = "wss" if scheme == "https" else "ws"
with connect(f"{ws_scheme}://127.0.0.1:{port}/ws/events?token={token}", sock=sock, ssl=tls,
             server_hostname="127.0.0.1" if tls else None, open_timeout=5) as ws:
    print("ready", flush=True)
    try:
        while True:
            event = json.loads(ws.recv(timeout=15))
            if event.get("type") == "files":
                print(json.dumps(event), flush=True)
                break
    except TimeoutError:
        print("timeout", flush=True)
PY
listener=$!
for _ in $(seq 1 50); do
  grep -q ready "$events" && break
  sleep 0.2
done
sleep 1
printf '# edited on the host\n' >>"$workspace/loom/demo02.yml"
wait "$listener"
if grep -q '"demo02.yml"' "$events"; then
  pass "an edit on the host reaches the page (live reload)"
else
  fail "an edit on the host reaches the page (live reload)" "$(tr '\n' ' ' <"$events" | cut -c1-200); try --poll"
fi
rm -f "$events"

# --- the real UI (optional) ----------------------------------------------------------------------

chrome=""
for c in "${CHROME:-}" /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [ -n "$c" ] && [ -x "$c" ] && chrome="$c" && break
done
if command -v node >/dev/null && [ -n "$chrome" ]; then
  git -C "$workspace" checkout -q -- loom/demo02.yml  # back to the original for the UI checks
  ui_base="$base"
  [ -n "$lan_ip" ] && ui_base="$scheme://$lan_ip:$port"  # in LAN mode, test the UI through the LAN address
  if CHROME="$chrome" LOOMVIZ_SMOKE_INSECURE="$tls" node "$repo/scripts/ui-smoke.mjs" "$ui_base/?token=$token" | sed 's/^/      /'; then
    pass "UI smoke test (scripts/ui-smoke.mjs)"
  else
    fail "UI smoke test (scripts/ui-smoke.mjs)"
  fi
else
  skip "UI smoke test" "needs node and Chrome/Chromium"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$failures check(s) failed."
  if [ "$native" = 0 ]; then
    echo "Container logs:"
    "${compose[@]}" logs --tail 40 loomviz | sed 's/token=[^ ]*/token=…/'
  fi
  exit 1
fi
