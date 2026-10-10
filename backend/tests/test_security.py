import pytest

from loomviz.config import Settings
from loomviz.security import check_bind, is_loopback

from .conftest import BASE_URL, make_client


def test_valid_request(client):
    response = client.get("/api/session")
    assert response.status_code == 200
    assert response.json()["state"] == "open"


def test_missing_token(client):
    assert client.get("/api/session", headers={"Authorization": ""}).status_code == 401


def test_wrong_token(client):
    assert client.get("/api/session", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_token_in_query_string_is_not_accepted_for_http(client):
    response = client.get("/api/session?token=test-token", headers={"Authorization": ""})
    assert response.status_code == 401


@pytest.mark.parametrize("host", ["evil.example:8000", "127.0.0.1:9999", "192.168.1.10:8000"])
def test_foreign_host_is_rejected(client, host):
    """DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends its own Host."""
    assert client.get("/api/session", headers={"Host": host}).status_code == 403


def test_foreign_origin_is_rejected(client):
    assert client.get("/api/session", headers={"Origin": "https://evil.example"}).status_code == 403


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8000", "http://localhost:8000"])
def test_own_origin_is_accepted(client, origin):
    assert client.get("/api/session", headers={"Origin": origin}).status_code == 200


def test_no_session_without_workspace(tmp_path):
    with make_client(None, tmp_path) as c:
        assert c.get("/api/session").json() == {"state": "none"}
        assert c.get("/api/files").status_code == 409


def test_frontend_served_without_token_api_still_protected(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>LoomViz</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with make_client(None, tmp_path, frontend_dist=dist) as c:
        anonymous = {"Authorization": ""}
        assert "LoomViz" in c.get("/", headers=anonymous).text
        assert c.get("/assets/app.js", headers=anonymous).text == "console.log(1)"
        assert "LoomViz" in c.get("/some/client/route", headers=anonymous).text  # SPA fallback
        assert c.get("/../../etc/passwd", headers=anonymous).status_code in (200, 404)
        assert "root:" not in c.get("/../../etc/passwd", headers=anonymous).text
        assert c.get("/api/session", headers=anonymous).status_code == 401


def test_bind_rules(monkeypatch):
    assert is_loopback("127.0.0.1") and is_loopback("localhost") and is_loopback("::1")
    assert not is_loopback("0.0.0.0") and not is_loopback("192.168.1.10")
    check_bind(Settings(host="127.0.0.1", allow_remote=False))
    with pytest.raises(SystemExit):
        check_bind(Settings(host="0.0.0.0", allow_remote=False))
    check_bind(Settings(host="0.0.0.0", allow_remote=True))


def test_base_url_matches_allowed_host():
    assert BASE_URL == "http://127.0.0.1:8000"


def test_session_payload(client):
    assert client.get("/api/session").json() == {
        "state": "open",
        "workspace": "repo",
        "loom_folder_exists": True,
    }


# --- running behind a port mapping (Docker, D18) -----------------------------------------------


def test_public_port_is_what_the_host_check_accepts(workspace, tmp_path):
    with make_client(workspace, tmp_path, port=8000, public_port=8100) as c:
        assert c.get("/api/session", headers={"Host": "127.0.0.1:8100"}).status_code == 200
        assert (
            c.get(
                "/api/session", headers={"Host": "localhost:8100", "Origin": "http://localhost:8100"}
            ).status_code
            == 200
        )
        # The container-internal port isn't what the browser uses, so it's refused.
        assert c.get("/api/session", headers={"Host": "127.0.0.1:8000"}).status_code == 403
        assert (
            c.get(
                "/api/session", headers={"Host": "127.0.0.1:8100", "Origin": "http://127.0.0.1:8000"}
            ).status_code
            == 403
        )


def test_launch_url_uses_loopback_and_public_port():
    s = Settings(host="0.0.0.0", port=8000, public_port=8100, token="t")
    assert s.launch_url == "http://127.0.0.1:8100/?token=t"
    assert Settings(host="127.0.0.1", port=8000, token="t").launch_url == "http://127.0.0.1:8000/?token=t"


def test_container_settings_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("LOOMVIZ_PUBLIC_PORT", "8123")
    monkeypatch.setenv("LOOMVIZ_FRONTEND_DIST", str(tmp_path))
    s = Settings()
    assert s.browser_port == 8123
    assert s.frontend_dist == tmp_path
    monkeypatch.delenv("LOOMVIZ_PUBLIC_PORT")
    assert Settings(port=8001).browser_port == 8001


def test_poll_switch_sets_watchfiles_polling(monkeypatch, tmp_path):
    import sys

    from loomviz import __main__ as cli

    monkeypatch.setenv("LOOMVIZ_POLL", "1")
    monkeypatch.delenv("WATCHFILES_FORCE_POLLING", raising=False)
    monkeypatch.setattr(sys, "argv", ["loomviz", str(tmp_path)])
    monkeypatch.setattr(cli.uvicorn, "run", lambda *a, **k: None)  # don't actually serve
    cli.main()
    import os

    assert os.environ["WATCHFILES_FORCE_POLLING"] == "true"
