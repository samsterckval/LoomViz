# syntax=docker/dockerfile:1
# LoomViz in one image (PLAN M3): the built front-end, the FastAPI back-end with WireViz,
# Graphviz and git (read-only status). Run it with compose.yaml or scripts/docker.sh, which add
# the folder mount, the port mapping, the host user and the hardening options.

# --- 1. Build the front-end ------------------------------------------------------------------
FROM node:24-slim AS frontend
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# --- 2. Runtime --------------------------------------------------------------------------------
FROM python:3.12-slim-trixie AS runtime

# Graphviz renders the diagrams (fonts for its text); git reads the repository status.
# Not version-pinned on purpose: Debian drops old package versions from its mirrors, so pins
# break rebuilds; the base image tag fixes the Debian release.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends graphviz fonts-dejavu-core git \
    && rm -rf /var/lib/apt/lists/*

# The mounted folder may be owned by a different uid than the container user; git would refuse
# to read it ("dubious ownership"). LoomViz only ever reads git (PLAN D16, D18).
RUN git config --system --add safe.directory /workspace \
    && mkdir -p /run/loomviz-tls

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv

# Install the back-end into /app/venv. Bytecode is compiled now: the root filesystem is
# read-only at run time.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/venv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev --no-editable

COPY --from=frontend /src/frontend/dist /app/frontend

ENV PATH=/app/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    LOOMVIZ_FRONTEND_DIST=/app/frontend \
    LOOMVIZ_ALLOW_REMOTE=1

# Default unprivileged user; compose runs the container as the host user instead.
USER 10001:10001
WORKDIR /workspace
EXPOSE 8000

# A TCP check (works with and without TLS): no extra endpoint, and every real endpoint needs
# the launch token.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import socket; socket.create_connection(('127.0.0.1', 8000), 2).close()"]

# Listen on all interfaces inside the container; compose publishes the port on 127.0.0.1 only,
# and LOOMVIZ_PUBLIC_PORT tells the Host/Origin checks which host port the browser uses.
ENTRYPOINT ["loomviz", "/workspace", "--host", "0.0.0.0", "--port", "8000"]
