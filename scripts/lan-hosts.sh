#!/usr/bin/env bash
# Print this machine's LAN host names and IP addresses, comma-separated, for
# LOOMVIZ_ALLOWED_HOSTS (SPEC FR-35). Used by scripts/docker.sh --lan: inside a container, the
# host's names and addresses aren't visible, so they're detected here, on the host.
set -uo pipefail

items=()
name="$(hostname 2>/dev/null || true)"
if [ -n "$name" ]; then
  items+=("$name")
  case "$name" in *.*) ;; *) items+=("$name.local") ;; esac  # mDNS
fi
fqdn="$(hostname -f 2>/dev/null || true)"
[ -n "$fqdn" ] && [ "$fqdn" != "$name" ] && items+=("$fqdn")
if command -v scutil >/dev/null 2>&1; then  # macOS: the Bonjour name others use
  bonjour="$(scutil --get LocalHostName 2>/dev/null || true)"
  [ -n "$bonjour" ] && items+=("$bonjour.local")
fi
if addresses="$(hostname -I 2>/dev/null)"; then  # Linux (GNU hostname)
  for ip in $addresses; do items+=("$ip"); done
elif command -v ipconfig >/dev/null 2>&1; then  # macOS
  for interface in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [ -n "$ip" ] && items+=("$ip")
  done
fi

seen=","
out=""
for item in "${items[@]}"; do
  item="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]')"
  case "$item" in
    ''|localhost|localhost.*|127.*|::1|fe80:*) continue ;;  # loopback is always allowed; link-local needs a zone
  esac
  case "$seen" in *",$item,"*) continue ;; esac
  seen="$seen$item,"
  out="${out:+$out,}$item"
done
printf '%s\n' "$out"
