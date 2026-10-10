import os

import pytest


def test_lists_only_yaml_inside_loom(client):
    body = client.get("/api/files").json()
    assert body["loom_folder_exists"] is True
    assert body["files"] == ["demo02.yml", "sub/small.yaml"]


def test_missing_loom_folder(client, workspace):
    import shutil

    shutil.rmtree(workspace / "loom")
    assert client.get("/api/files").json() == {"loom_folder": "loom", "loom_folder_exists": False, "files": []}


def test_read_returns_content_and_etag(client, workspace):
    response = client.get("/api/files/sub/small.yaml")
    assert response.status_code == 200
    assert response.text == (workspace / "loom" / "sub" / "small.yaml").read_text()
    assert response.headers["etag"].startswith('"')


@pytest.mark.parametrize(
    "path",
    ["../README.md", "../docker-compose.yml", "sub/../../README.md", "..%2FREADME.md", ".hidden.yml", "notes.txt"],
)
def test_rejects_paths_outside_loom_or_not_yaml(client, path):
    assert client.get(f"/api/files/{path}").status_code in (400, 404)
    assert "not a harness" not in client.get(f"/api/files/{path}").text


def test_rejects_symlink_escaping_loom(client, workspace):
    os.symlink(workspace / "docker-compose.yml", workspace / "loom" / "escape.yml")
    assert client.get("/api/files/escape.yml").status_code == 400
    assert "escape.yml" not in client.get("/api/files").json()["files"]


def test_missing_file(client):
    assert client.get("/api/files/nope.yml").status_code == 404


def test_write_existing_requires_matching_etag(client, workspace):
    etag = client.get("/api/files/demo02.yml").headers["etag"]
    assert client.put("/api/files/demo02.yml", content=b"a: 1\n").status_code == 428
    assert client.put("/api/files/demo02.yml", content=b"a: 1\n", headers={"If-Match": '"stale"'}).status_code == 412

    response = client.put("/api/files/demo02.yml", content=b"a: 1\n", headers={"If-Match": etag})
    assert response.status_code == 204
    new_etag = response.headers["etag"]
    assert new_etag != etag
    assert client.get("/api/files/demo02.yml").text == "a: 1\n"
    # The old ETag is now stale: a second editor with the old version gets 412.
    assert client.put("/api/files/demo02.yml", content=b"b: 2\n", headers={"If-Match": etag}).status_code == 412
    assert not [p for p in (workspace / "loom").iterdir() if p.name.startswith(".loomviz-tmp-")]


def test_create_new_file_and_folders(client, workspace):
    response = client.put("/api/files/new/deep/a.yml", content=b"x: 1\n", headers={"If-None-Match": "*"})
    assert response.status_code == 204
    assert (workspace / "loom" / "new" / "deep" / "a.yml").read_text() == "x: 1\n"
    again = client.put("/api/files/new/deep/a.yml", content=b"x: 2\n", headers={"If-None-Match": "*"})
    assert again.status_code == 412


def test_first_write_creates_loom_folder(client, workspace):
    import shutil

    shutil.rmtree(workspace / "loom")
    assert client.put("/api/files/a.yml", content=b"x: 1\n", headers={"If-None-Match": "*"}).status_code == 204
    assert (workspace / "loom" / "a.yml").is_file()


def test_write_rejects_non_yaml(client):
    assert client.put("/api/files/foo.txt", content=b"x", headers={"If-None-Match": "*"}).status_code == 400


def test_rename(client, workspace):
    assert client.post("/api/files/sub/small.yaml/rename", json={"to": "demo02.yml"}).status_code == 409
    assert client.post("/api/files/sub/small.yaml/rename", json={"to": "../out.yml"}).status_code == 400
    assert client.post("/api/files/sub/small.yaml/rename", json={"to": "moved/small.yml"}).status_code == 200
    assert (workspace / "loom" / "moved" / "small.yml").is_file()
    assert not (workspace / "loom" / "sub" / "small.yaml").exists()


def test_delete(client):
    assert client.delete("/api/files/sub/small.yaml").status_code == 204
    assert client.get("/api/files/sub/small.yaml").status_code == 404
    assert client.delete("/api/files/sub/small.yaml").status_code == 404
