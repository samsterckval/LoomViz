"""Opt-in LAN access with optional TLS (FR-35, D19)."""

import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time

import httpx
import pytest
import uvicorn

from loomviz import lan
from loomviz.app import create_app
from loomviz.config import Settings
from loomviz.security import allowed_hosts, allowed_origins

from .conftest import TOKEN, make_client


def test_allowed_hosts_add_lan_names_with_the_browser_port():
    s = Settings(port=8000, public_port=8100, allowed_hosts=["box", "192.168.1.20", "fe80::1", "fd00::5"])
    hosts = allowed_hosts(s)
    assert {"127.0.0.1:8100", "localhost:8100", "box:8100", "192.168.1.20:8100", "[fd00::5]:8100"} <= hosts
    assert "box:8000" not in hosts
    assert "http://box:8100" in allowed_origins(s)


def test_tls_switches_origins_and_urls_to_https(tmp_path):
    s = Settings(
        port=8443, allowed_hosts=["box"], tls_cert=tmp_path / "c.pem", tls_key=tmp_path / "k.pem", token="t"
    )
    assert s.scheme == "https"
    assert "https://box:8443" in allowed_origins(s) and "http://box:8443" not in allowed_origins(s)
    assert s.launch_url == "https://127.0.0.1:8443/?token=t"
    assert s.lan_urls == ["https://box:8443/?token=t"]


def test_lan_host_is_accepted_and_others_still_refused(workspace, tmp_path):
    with make_client(workspace, tmp_path, allowed_hosts=["box", "192.168.1.20"]) as c:
        assert (
            c.get("/api/session", headers={"Host": "box:8000", "Origin": "http://box:8000"}).status_code
            == 200
        )
        assert c.get("/api/session", headers={"Host": "BOX:8000"}).status_code == 200  # case-insensitive
        assert c.get("/api/session", headers={"Host": "192.168.1.20:8000"}).status_code == 200
        assert c.get("/api/session", headers={"Host": "evil.example:8000"}).status_code == 403
        assert (
            c.get("/api/session", headers={"Host": "box:8000", "Origin": "http://evil.example"}).status_code
            == 403
        )
        assert c.get("/api/session", headers={"Host": "box:8000", "Authorization": ""}).status_code == 401


def test_allowed_hosts_from_environment(monkeypatch):
    monkeypatch.setenv("LOOMVIZ_ALLOWED_HOSTS", " Box , 192.168.1.20,,")
    assert Settings().allowed_hosts == ["box", "192.168.1.20"]


def test_detect_lan_hosts(monkeypatch):
    monkeypatch.setattr(socket, "gethostname", lambda: "box")
    monkeypatch.setattr(socket, "getfqdn", lambda: "box.lan.example")
    monkeypatch.setattr(lan, "_primary_ipv4", lambda: "192.168.1.20")
    monkeypatch.setattr(lan, "_macos_bonjour_name", lambda: None)
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (0, 0, 0, "", ("127.0.1.1", 0)),
            (0, 0, 0, "", ("192.168.1.20", 0)),
            (0, 0, 0, "", ("fe80::1%en0", 0, 0, 0)),
            (0, 0, 0, "", ("fd00::5", 0, 0, 0)),
        ],
    )
    assert lan.detect_lan_hosts() == ["box", "box.local", "box.lan.example", "192.168.1.20", "fd00::5"]


def run_cli(monkeypatch, capsys, tmp_path, *args):
    from loomviz import __main__ as cli

    captured: dict = {}
    monkeypatch.setattr(sys, "argv", ["loomviz", str(tmp_path), *args])
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, **kw: captured.update(kw, app=app))
    monkeypatch.setattr(cli, "detect_lan_hosts", lambda: ["box", "192.168.1.20"])
    cli.main()
    return captured, capsys.readouterr().out


def test_cli_lan_mode(monkeypatch, capsys, tmp_path):
    run, out = run_cli(
        monkeypatch, capsys, tmp_path, "--lan", "--allow-host", "harness.example", "--port", "8123"
    )
    assert run["host"] == "0.0.0.0" and run["port"] == 8123
    assert run["ssl_certfile"] is None
    assert "or: http://box:8123/?token=" in out and "or: http://harness.example:8123/?token=" in out
    assert "plain HTTP" in out


def test_cli_default_is_local_only(monkeypatch, capsys, tmp_path):
    run, out = run_cli(monkeypatch, capsys, tmp_path)
    assert run["host"] == "127.0.0.1"
    # Open tabs hold a WebSocket; without a limit, Ctrl+C / docker stop would wait forever.
    assert run["timeout_graceful_shutdown"] == 3
    assert "or:" not in out and "Warning" not in out


def test_cli_tls_needs_both_files(monkeypatch, capsys, tmp_path):
    cert = tmp_path / "cert.pem"
    cert.write_text("x")
    with pytest.raises(SystemExit):
        run_cli(monkeypatch, capsys, tmp_path, "--tls-cert", str(cert))
    with pytest.raises(SystemExit):
        run_cli(
            monkeypatch, capsys, tmp_path, "--tls-cert", str(cert), "--tls-key", str(tmp_path / "missing.pem")
        )


@pytest.fixture
def self_signed(tmp_path):
    if not shutil.which("openssl"):
        pytest.skip("openssl not installed")
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=127.0.0.1",
            "-keyout",
            str(key),
            "-out",
            str(cert),
        ],
        check=True,
        capture_output=True,
    )
    return cert, key


def test_https_end_to_end(workspace, tmp_path, self_signed):
    cert, key = self_signed
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    settings = Settings(
        workspace=workspace,
        port=port,
        token=TOKEN,
        tls_cert=cert,
        tls_key=key,
        frontend_dist=tmp_path / "no-dist",
    )
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings),
            host="127.0.0.1",
            port=port,
            log_level="warning",
            ssl_certfile=str(cert),
            ssl_keyfile=str(key),
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        context = ssl.create_default_context(cafile=str(cert))
        context.check_hostname = False  # self-signed for CN=127.0.0.1; the chain is what we check
        with httpx.Client(verify=context) as http:
            ok = http.get(
                f"https://127.0.0.1:{port}/api/session",
                headers={"Authorization": f"Bearer {TOKEN}", "Origin": f"https://127.0.0.1:{port}"},
            )
            assert ok.status_code == 200
            plain_origin = http.get(
                f"https://127.0.0.1:{port}/api/session",
                headers={"Authorization": f"Bearer {TOKEN}", "Origin": f"http://127.0.0.1:{port}"},
            )
            assert plain_origin.status_code == 403
        with pytest.raises(httpx.HTTPError):
            httpx.get(f"http://127.0.0.1:{port}/api/session", timeout=3)  # plain HTTP isn't served
    finally:
        server.should_exit = True
        thread.join(timeout=10)
