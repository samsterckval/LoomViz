import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from loomviz.app import create_app
from loomviz.config import Settings

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO = REPO_ROOT / "examples" / "loom" / "demo02.yml"
TOKEN = "test-token"
BASE_URL = "http://127.0.0.1:8000"


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    """A repository root laid out like a loom repo, plus YAML outside loom/ that must be ignored."""
    root = tmp_path / "repo"
    (root / "loom" / "sub").mkdir(parents=True)
    shutil.copy(DEMO, root / "loom" / "demo02.yml")
    (root / "loom" / "sub" / "small.yaml").write_text("connectors:\n  X1: {pincount: 2}\n")
    (root / ".github" / "workflows").mkdir(parents=True)
    (root / ".github" / "workflows" / "ci.yml").write_text("on: push\n")
    (root / "docker-compose.yml").write_text("services: {}\n")
    (root / "README.md").write_text("not a harness\n")
    return root


def make_client(workspace: Path | None, tmp_path: Path, **overrides) -> TestClient:
    settings = Settings(
        dev_workspace=workspace,
        token=TOKEN,
        frontend_dist=overrides.pop("frontend_dist", tmp_path / "no-dist"),
        **overrides,
    )
    return TestClient(create_app(settings), base_url=BASE_URL, headers={"Authorization": f"Bearer {TOKEN}"})


@pytest.fixture
def client(workspace: Path, tmp_path: Path) -> Iterator[TestClient]:
    with make_client(workspace, tmp_path) as c:
        yield c
