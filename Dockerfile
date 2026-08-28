# syntax=docker/dockerfile:1

# SDA Toolbox — backend API image.
# No changes to the application: everything here works around the app as it
# exists (see DOCKERIZATION_PLAN.md in the repo root for the reasoning behind
# each non-obvious step below).

ARG PYTHON_VERSION=3.13

# ---------------------------------------------------------------------------
# Stage 1: builder — compiles psycopg2 and resolves/installs dependencies
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

# build-essential + libpq-dev: psycopg2 (not psycopg2-binary) compiles from
# source at install time and needs a C compiler + libpq headers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# uv: reproducible installs straight from uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /bin/

WORKDIR /app

ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_HTTP_TIMEOUT=300

# uv's default per-request HTTP timeout (30s) is too short for some of the
# larger wheels this project pulls in transitively (e.g. sentry-sdk, dragged
# in via fastapi[standard] -> fastapi-cli[standard] -> fastapi-cloud-cli) on
# a slow or congested connection — `uv sync` below failed with exactly this
# ("Failed to download distribution due to network timeout... Try increasing
# UV_HTTP_TIMEOUT"). 300s gives real headroom without masking a genuinely
# dead connection.

# --- dependency layer, cached independently of application source changes ---
# pyproject.toml declares readme = "README.md", so uv needs it present even
# for a dependency-only sync to resolve project metadata.
COPY pyproject.toml uv.lock README.md ./

# Default (main) dependency group only — no --all-groups needed. The
# top-level `from pyngrok import ngrok` in sda_toolbox.py that used to force
# the dev-only pyngrok dependency into every install has been moved to a
# lazy import inside `if __name__ == "__main__"` (see that file), so a
# production install no longer needs the "dev" group at all.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# --- application layer ---
# Copied after the dependency install so editing source doesn't invalidate
# the (slow) dependency layer above. `uv sync` installs the local project in
# EDITABLE mode by default. config.yaml, planfeld_config.yaml and
# members.json are also now declared in pyproject.toml's
# [tool.setuptools.package-data], so a built wheel would carry them too —
# editable mode remains the simpler/faster choice for this Dockerfile either
# way, since it skips a build step.
COPY src/ ./src

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# ---------------------------------------------------------------------------
# Stage 2: runtime — slim image, only what's needed to run the service
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

# libpq5: psycopg2's runtime shared library (no compiler needed here).
# ca-certificates: outbound HTTPS (e.g. osmnx fetching OSM data, DB TLS).
# Confirmed NOT needed: wkhtmltopdf — requirements.txt (a full dev-env freeze)
# lists pdfkit/wkhtmltopdf, but grepping the actual source turned up zero
# references to either; PDF generation in toolbox/mlos/planfeld/microplan/
# uses reportlab (pure Python) instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/src /app/src
COPY --chown=appuser:appuser pyproject.toml README.md ./

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# toolbox/utils/logger.py resolves its log directory as
# <package_dir>/logs/<date>/... (`__file__`-relative — see
# toolbox/utils/workspace.py), i.e. inside the installed package under
# /app/src/toolbox/logs at runtime. Pre-create it, owned by the runtime user,
# so the app can write there and a volume can be mounted over it (see
# docker-compose.yml) without a container restart hitting a permissions wall.
RUN mkdir -p /app/src/toolbox/logs && chown -R appuser:appuser /app/src/toolbox/logs

# Same reasoning, for toolbox/job_tracker/store.py's jobs.sqlite3 — resolved
# the same __file__-relative way, landing at this sibling path.
RUN mkdir -p /app/src/toolbox/data && chown -R appuser:appuser /app/src/toolbox/data

USER appuser

EXPOSE 8000

# kaleido (used in toolbox/reporting/reporter.py and .../timespent.py to
# render Plotly figures) bundles its own headless Chromium. Running it as a
# non-root container user is usually fine, but if chart-producing endpoints
# fail specifically with a Chromium/sandbox error, that's the first thing to
# revisit here (e.g. a KALEIDO_* env var or switching this back to root while
# debugging) — see Phase 9 of DOCKERIZATION_PLAN.md for the exact endpoint to
# test this against.

# Do NOT run `python -m toolbox.sda_toolbox` or `python src/toolbox/sda_toolbox.py`
# — the `if __name__ == "__main__":` block in that file calls
# `ngrok.connect()`, a dev-only public-tunnel workflow with no place here.
# Invoke uvicorn directly against the ASGI app object instead.
CMD ["uvicorn", "toolbox.sda_toolbox:app", "--host", "0.0.0.0", "--port", "8000"]
