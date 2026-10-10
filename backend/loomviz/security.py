"""Launch token, Host and Origin checks, and bind rules (SPEC §9, PLAN §3).

Every /api and /ws request must:
  1. carry an allowed Host header (blocks DNS rebinding),
  2. carry no Origin, or an allowed one (blocks cross-site requests from other pages),
  3. carry the launch token: `Authorization: Bearer <token>` on HTTP, `?token=` on WebSockets.
Static front-end files need none of this; they contain no data.
"""

from __future__ import annotations

import ipaddress
import json
import secrets

from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings

PROTECTED_PREFIXES = ("/api", "/ws")


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_bind(settings: Settings) -> None:
    """Refuse non-loopback addresses unless LOOMVIZ_ALLOW_REMOTE=1 (set only inside Docker)."""
    if not is_loopback(settings.host) and not settings.allow_remote:
        raise SystemExit(
            f"Refusing to listen on {settings.host}: LoomViz can read and write files in your folder. "
            "Use 127.0.0.1, or set LOOMVIZ_ALLOW_REMOTE=1 if a container or firewall restricts access."
        )


def allowed_hosts(settings: Settings) -> set[str]:
    """Host headers we accept: loopback names plus, for LAN access, the configured names (FR-35),
    each with the port the browser addresses (in Docker, the host-side port, D18)."""
    from .lan import host_for_url

    names = ["127.0.0.1", "localhost", "[::1]", *(host_for_url(h) for h in settings.allowed_hosts)]
    return {f"{name.lower()}:{settings.browser_port}" for name in names}


def allowed_origins(settings: Settings) -> set[str]:
    return {f"{settings.scheme}://{host}" for host in allowed_hosts(settings)}


class SecurityMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.token = settings.token
        self.hosts = allowed_hosts(settings)
        self.origins = allowed_origins(settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket") or not scope["path"].startswith(PROTECTED_PREFIXES):
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        if headers.get("host", "").lower() not in self.hosts:
            await self._deny(scope, receive, send, 403, "Host not allowed")
            return
        origin = headers.get("origin")
        if origin is not None and origin.lower() not in self.origins:
            await self._deny(scope, receive, send, 403, "Origin not allowed")
            return
        if not secrets.compare_digest(self._presented_token(scope, headers), self.token):
            await self._deny(scope, receive, send, 401, "Missing or invalid launch token")
            return
        await self.app(scope, receive, send)

    @staticmethod
    def _presented_token(scope: Scope, headers: dict[str, str]) -> str:
        if scope["type"] == "websocket":
            from urllib.parse import parse_qs

            return parse_qs(scope.get("query_string", b"").decode()).get("token", [""])[0]
        auth = headers.get("authorization", "")
        return auth[len("Bearer ") :] if auth.startswith("Bearer ") else ""

    @staticmethod
    async def _deny(scope: Scope, receive: Receive, send: Send, status: int, message: str) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4000 + status})
            return
        body = json.dumps({"detail": message}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
