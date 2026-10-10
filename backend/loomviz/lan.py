"""Host names and addresses this machine is reachable at on the local network (SPEC FR-35).

Used by `loomviz --lan` to fill the Host/Origin allow-list. In Docker the container can't see
the host's names, so scripts/docker.sh detects them on the host and passes them in instead.
"""

from __future__ import annotations

import ipaddress
import socket
import subprocess
import sys


def _usable(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    return not (ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip.is_multicast)


def _primary_ipv4() -> str | None:
    """The address of the interface used for outgoing traffic (no packet is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # TEST-NET-1: never routed, nothing is sent for UDP connect
            return str(s.getsockname()[0])
    except OSError:
        return None


def _macos_bonjour_name() -> str | None:
    """On macOS, other machines reach this one as <LocalHostName>.local, which can differ
    from the Unix host name."""
    if sys.platform != "darwin":
        return None
    try:
        result = subprocess.run(  # noqa: S603 - fixed command
            ["/usr/sbin/scutil", "--get", "LocalHostName"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    name = result.stdout.strip()
    return f"{name}.local" if result.returncode == 0 and name else None


def detect_lan_hosts() -> list[str]:
    names: list[str] = []
    bonjour = _macos_bonjour_name()
    if bonjour:
        names.append(bonjour)
    hostname = socket.gethostname()
    if hostname:
        names.append(hostname)
        if "." not in hostname:
            names.append(f"{hostname}.local")  # mDNS (macOS, most Linux desktops)
        fqdn = socket.getfqdn()
        if fqdn and fqdn != hostname and "." in fqdn and not fqdn.endswith(".arpa"):
            names.append(fqdn)
    addresses: list[str] = []
    primary = _primary_ipv4()
    if primary:
        addresses.append(primary)
    try:
        for *_, sockaddr in socket.getaddrinfo(hostname, None):
            addresses.append(str(sockaddr[0]))
    except OSError:
        pass
    found: list[str] = []
    for item in names + [a for a in addresses if _usable(a)]:
        item = item.lower()
        if item not in found and item not in ("localhost",):
            found.append(item)
    return found


def host_for_url(name: str) -> str:
    """IPv6 literals need brackets in URLs and Host headers."""
    try:
        if ipaddress.ip_address(name).version == 6:
            return f"[{name}]"
    except ValueError:
        pass
    return name
