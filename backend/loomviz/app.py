"""FastAPI app factory: API routes, security middleware and the built front-end."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import git
from .config import LOOM_FOLDER, Settings
from .files import FileError, Workspace
from .render import Renderer
from .security import SecurityMiddleware
from .watch import EventHub, run_watchers


class RenameBody(BaseModel):
    to: str


class RenderBody(BaseModel):
    yaml: str
    path: str | None = None
    html: bool = False


def create_app(settings: Settings) -> FastAPI:
    workspace = Workspace(settings.workspace) if settings.workspace else None
    renderer = (
        Renderer(
            workspace.loom,
            workers=settings.render_workers,
            timeout_s=settings.render_timeout_s,
            cache_size=settings.render_cache_size,
        )
        if workspace
        else None
    )

    hub = EventHub()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        stop = asyncio.Event()
        watchers = asyncio.create_task(run_watchers(workspace.root, hub, stop)) if workspace else None
        if renderer:
            renderer.warm_up()
        yield
        stop.set()
        if watchers:
            watchers.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await watchers
        if renderer:
            renderer.close()

    app = FastAPI(title="LoomViz", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.renderer = renderer
    app.state.hub = hub
    app.add_middleware(SecurityMiddleware, settings=settings)

    @app.exception_handler(FileError)
    async def file_error(_: Request, exc: FileError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    def open_workspace() -> Workspace:
        if workspace is None:
            raise HTTPException(409, "No session is open")
        return workspace

    def open_renderer() -> Renderer:
        if renderer is None:
            raise HTTPException(409, "No session is open")
        return renderer

    # -- workspace (FR-33) ----------------------------------------------------------------------

    @app.get("/api/session")
    def get_session() -> dict[str, Any]:
        if workspace is None:
            return {"state": "none"}
        return {
            "state": "open",
            "workspace": workspace.root.name,
            "loom_folder_exists": workspace.loom.is_dir(),
        }

    @app.post("/api/loom")
    def create_loom_folder() -> dict[str, Any]:
        ws = open_workspace()
        ws.loom.mkdir(exist_ok=True)
        return {"loom_folder": LOOM_FOLDER, "loom_folder_exists": True}

    @app.get("/api/git/status")
    def git_status() -> dict[str, Any]:
        return git.status(open_workspace().root)

    # -- files ----------------------------------------------------------------------------------

    @app.get("/api/files")
    def list_files() -> dict[str, Any]:
        ws = open_workspace()
        return {"loom_folder": LOOM_FOLDER, "loom_folder_exists": ws.loom.is_dir(), "files": ws.list()}

    @app.post("/api/files/{path:path}/rename")
    def rename_file(path: str, body: RenameBody) -> dict[str, str]:
        open_workspace().rename(path, body.to)
        return {"path": body.to}

    @app.get("/api/files/{path:path}")
    def read_file(path: str) -> Response:
        data, etag = open_workspace().read(path)
        return Response(data, media_type="text/yaml; charset=utf-8", headers={"ETag": etag})

    @app.put("/api/files/{path:path}")
    async def write_file(
        path: str,
        request: Request,
        if_match: str | None = Header(default=None),
        if_none_match: str | None = Header(default=None),
    ) -> Response:
        data = await request.body()
        etag = open_workspace().write(path, data, if_match=if_match, if_none_match=if_none_match)
        return Response(status_code=204, headers={"ETag": etag})

    @app.delete("/api/files/{path:path}")
    def delete_file(path: str) -> Response:
        open_workspace().delete(path)
        return Response(status_code=204)

    # -- events (FR-9, FR-34) ------------------------------------------------------------------

    @app.websocket("/ws/events")
    async def events(websocket: WebSocket) -> None:
        # The launch token and Host/Origin checks already ran in SecurityMiddleware.
        await websocket.accept()
        queue = hub.subscribe()
        try:
            while True:
                await websocket.send_json(await queue.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.unsubscribe(queue)

    # -- rendering ------------------------------------------------------------------------------

    @app.post("/api/render")
    async def render(body: RenderBody) -> dict[str, Any]:
        r = open_renderer()
        file_path: Path | None = None
        if body.path:
            file_path = open_workspace().resolve(body.path)
        return await r.render(body.yaml, file_path, html=body.html)

    # -- front-end (built files; no token needed, they contain no data) -------------------------

    dist = settings.frontend_dist
    if dist.is_dir():
        dist_real = dist.resolve()

        @app.get("/{rest:path}", include_in_schema=False)
        def frontend(rest: str) -> Response:
            if rest.startswith(("api/", "ws/")):
                raise HTTPException(404)
            candidate = (dist / rest).resolve()
            if rest and candidate.is_file() and candidate.is_relative_to(dist_real):
                return FileResponse(candidate)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return app
