"""Harness files in the loom folder: sandboxed paths, atomic writes, ETags (SPEC FR-7, FR-8)."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path, PurePosixPath

from .config import LOOM_FOLDER

YAML_SUFFIXES = (".yml", ".yaml")
TEMP_PREFIX = ".loomviz-tmp-"


class FileError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def etag_for(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest()[:32] + '"'


class Workspace:
    """A repository root; all file access is confined to its loom folder."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.loom = self.root / LOOM_FOLDER

    # -- sandboxing ---------------------------------------------------------------------------

    def resolve(self, rel: str, *, yaml_only: bool = True) -> Path:
        """Map a loom-relative path to an absolute path inside the loom folder, or raise 400."""
        if not rel or "\x00" in rel or "\\" in rel:
            raise FileError(400, "Invalid path")
        pure = PurePosixPath(rel)
        if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts) or rel.endswith("/"):
            raise FileError(400, "Path must be relative to loom/ and stay inside it")
        if any(part.startswith(".") for part in pure.parts):
            raise FileError(400, "Hidden files and folders are not allowed")
        if yaml_only and pure.suffix.lower() not in YAML_SUFFIXES:
            raise FileError(400, "Only .yml and .yaml files are allowed")
        candidate = self.loom.joinpath(*pure.parts)
        # Resolve symlinks (of the file or any parent) and check the result is still inside loom/.
        loom_real = self.loom.resolve()
        if not candidate.resolve().is_relative_to(loom_real):
            raise FileError(400, "Path escapes the loom folder")
        return candidate

    def relative(self, path: Path) -> str:
        return path.relative_to(self.loom).as_posix()

    # -- operations ---------------------------------------------------------------------------

    def list(self) -> list[str]:
        if not self.loom.is_dir():
            return []
        loom_real = self.loom.resolve()
        found: list[str] = []
        for dirpath, dirnames, filenames in os.walk(self.loom):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in filenames:
                path = Path(dirpath) / name
                if name.startswith(".") or path.suffix.lower() not in YAML_SUFFIXES:
                    continue
                if not path.resolve().is_relative_to(loom_real):
                    continue  # symlink pointing outside loom/
                found.append(self.relative(path))
        return sorted(found)

    def read(self, rel: str) -> tuple[bytes, str]:
        path = self.resolve(rel)
        if not path.is_file():
            raise FileError(404, "File not found")
        data = path.read_bytes()
        return data, etag_for(data)

    def write(self, rel: str, data: bytes, *, if_match: str | None, if_none_match: str | None) -> str:
        """Atomic write with optimistic concurrency. Returns the new ETag.

        Existing files need If-Match with the current ETag (412 if it changed meanwhile).
        New files need If-None-Match: * (412 if the file appeared meanwhile).
        """
        path = self.resolve(rel)
        exists = path.is_file()
        if exists:
            if if_none_match == "*":
                raise FileError(412, "File already exists")
            if if_match is None:
                raise FileError(428, "If-Match header required to overwrite a file")
            if if_match != etag_for(path.read_bytes()):
                raise FileError(412, "File changed on disk since it was loaded")
        elif if_match is not None:
            raise FileError(412, "File no longer exists")
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=TEMP_PREFIX)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return etag_for(data)

    def rename(self, rel: str, new_rel: str) -> None:
        src = self.resolve(rel)
        dst = self.resolve(new_rel)
        if not src.is_file():
            raise FileError(404, "File not found")
        if dst.exists():
            raise FileError(409, "A file with that name already exists")
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.rename(src, dst)

    def delete(self, rel: str) -> None:
        path = self.resolve(rel)
        if not path.is_file():
            raise FileError(404, "File not found")
        path.unlink()
