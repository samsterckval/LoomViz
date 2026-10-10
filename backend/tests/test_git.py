"""Read-only git status (FR-34), against throwaway repositories built in each test."""

import subprocess
from pathlib import Path

import pytest

from loomviz import git

pytestmark = pytest.mark.skipif(
    subprocess.run(["git", "--version"], capture_output=True).returncode != 0, reason="git not installed"
)


def run(cwd: Path, *args: str) -> None:
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=t@example.com",
            "-c",
            "init.defaultBranch=main",
            *args,
        ],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "loom" / "sub").mkdir(parents=True)
    (root / "loom" / "a.yml").write_text("a: 1\n")
    (root / "loom" / "b.yml").write_text("b: 1\n")
    (root / "loom" / "sub" / "c.yml").write_text("c: 1\n")
    (root / "README.md").write_text("readme\n")
    run(root, "init")
    run(root, "add", ".")
    run(root, "commit", "-m", "init")
    return root


def test_clean_repository(repo):
    assert git.status(repo) == {"repository": True, "branch": "main", "detached": False, "changed": []}


def test_changes_inside_loom_only(repo):
    (repo / "loom" / "a.yml").write_text("a: 2\n")  # modified
    (repo / "loom" / "b.yml").unlink()  # deleted
    (repo / "loom" / "new file.yml").write_text("n: 1\n")  # untracked, with a space
    (repo / "loom" / "sub" / "staged.yml").write_text("s: 1\n")
    run(repo, "add", "loom/sub/staged.yml")  # added
    (repo / "README.md").write_text("changed outside loom\n")
    result = git.status(repo)
    assert sorted((c["path"], c["status"]) for c in result["changed"]) == [
        ("a.yml", "modified"),
        ("b.yml", "deleted"),
        ("new file.yml", "untracked"),
        ("sub/staged.yml", "added"),
    ]


def test_rename(repo):
    run(repo, "mv", "loom/a.yml", "loom/renamed.yml")
    assert git.status(repo)["changed"] == [{"path": "renamed.yml", "status": "renamed"}]


def test_detached_head(repo):
    run(repo, "checkout", "--detach")
    result = git.status(repo)
    assert result["detached"] is True and result["branch"] is None


def test_workspace_in_a_subfolder_of_the_repository(repo):
    project = repo / "projects" / "p1"
    (project / "loom").mkdir(parents=True)
    (project / "loom" / "x.yml").write_text("x: 1\n")
    assert git.status(project)["changed"] == [{"path": "x.yml", "status": "untracked"}]


def test_not_a_repository(tmp_path):
    (tmp_path / "loom").mkdir()
    assert git.status(tmp_path) == {"repository": False}


def test_status_does_not_write_to_the_repository(repo):
    (repo / "loom" / "a.yml").write_text("a: 2\n")
    index = repo / ".git" / "index"
    before = (index.read_bytes(), index.stat().st_mtime_ns)
    for _ in range(3):
        git.status(repo)
    assert (index.read_bytes(), index.stat().st_mtime_ns) == before


def test_endpoint(client, workspace):
    assert client.get("/api/git/status").json() == {"repository": False}  # the test workspace isn't a repo
