import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from toolbox.utils import workspace

# What this is: a small, deliberately separate SQLite store that persists
# the Dashboard's Active/Completed/Failed job history server-side, so it
# survives a page reload and is shared across every user of this single
# cloud instance — replacing the earlier React-only tracker
# (src/frontend/src/state/jobTracker.tsx), which reset to zero on every
# refresh and was invisible to anyone else. This is intentionally NOT part
# of toolbox/models/db/models.py — those are SQLAlchemy/GeoAlchemy2 models
# over the external Postgres/PostGIS boundary database (config.yaml's
# `datasets` block); this is a small operational log with nothing spatial
# in it, so a lightweight stdlib-sqlite3 file fits it better than pulling
# that table into the PostGIS schema or standing up a second Postgres
# connection just for it.
#
# Rows are written automatically by JobLoggingMiddleware (see middleware.py)
# for every request that hits a known tool endpoint — no page has to
# remember to report anything, which is exactly why "automatic backend
# middleware" was picked over a frontend-reported design.

DB_ENV_VAR = 'JOBS_DB_PATH'


@workspace
def _default_data_dir(folder: str = None) -> str:
    # Same __file__-relative resolution toolbox/utils/logger.py uses for
    # `logs/` (see toolbox/utils/workspace.py's `workspace` decorator) — this
    # lands at <installed-package>/data at runtime, i.e. /app/src/toolbox/data
    # in the Docker image, a sibling of .../toolbox/logs. Mount a volume over
    # it the same way docker-compose.yml already does for logs/ so the job
    # history survives `docker compose down`/container recreation.
    data_dir = os.path.join(folder, 'data')
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def _resolve_db_path() -> str:
    override = os.environ.get(DB_ENV_VAR)
    if override:
        os.makedirs(os.path.dirname(override) or '.', exist_ok=True)
        return override
    return os.path.join(_default_data_dir(), 'jobs.sqlite3')


DB_PATH = _resolve_db_path()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    label TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL,
    status_code INTEGER,
    client_host TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at);
"""


@contextmanager
def _connect():
    # A fresh short-lived connection per call rather than one long-lived
    # module-level connection — sqlite3 connections aren't safe to share
    # across threads by default, and FastAPI runs sync code (this module is
    # plain sqlite3, not async) in a worker thread pool, so a shared
    # connection would need check_same_thread=False plus its own locking
    # anyway. WAL + a busy_timeout instead makes concurrent open/close from
    # multiple threads (or multiple uvicorn workers, if ever run with
    # --workers > 1) safe without a bigger dependency.
    conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def _reconcile_stale_active_jobs() -> None:
    # Any row still 'active' at process start is, by definition, a request
    # that never got to finish in a process that no longer exists — the only
    # way that happens is the backend restarting (or crashing) mid-request.
    # That's exactly the shape of the "have to restart after an intensive
    # spatial run" issue reported separately — without this sweep, a job
    # caught by that restart would show as a permanent ghost "Active" count
    # on the Dashboard until the heat death of the universe. Runs once at
    # import time, before anything else can INSERT a fresh 'active' row.
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "UPDATE jobs SET status = 'failed', ended_at = ?, error = ? "
            "WHERE status = 'active'",
            (now, 'interrupted — backend restarted or crashed while this job was running'),
        )


init_db()
_reconcile_stale_active_jobs()


def start_job(tool: str, label: str, method: str, path: str, client_host: Optional[str]) -> str:
    job_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            'INSERT INTO jobs (id, tool, label, method, path, status, client_host, started_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (job_id, tool, label, method, path, 'active', client_host, started_at),
        )
    return job_id


def finish_job(job_id: str, status: str, status_code: Optional[int], error: Optional[str] = None) -> None:
    ended_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        row = conn.execute('SELECT started_at FROM jobs WHERE id = ?', (job_id,)).fetchone()
        duration_ms = None
        if row:
            try:
                started = datetime.fromisoformat(row[0])
                duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            except ValueError:
                duration_ms = None
        conn.execute(
            'UPDATE jobs SET status = ?, status_code = ?, ended_at = ?, duration_ms = ?, error = ? WHERE id = ?',
            (status, status_code, ended_at, duration_ms, error, job_id),
        )


def get_summary() -> dict:
    with _connect() as conn:
        rows = conn.execute('SELECT status, COUNT(*) FROM jobs GROUP BY status').fetchall()
    counts = {'active': 0, 'completed': 0, 'failed': 0}
    for status, count in rows:
        if status in counts:
            counts[status] = count
    counts['total'] = sum(counts.values())
    return counts


def get_recent(limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 200))
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT id, tool, label, method, path, status, status_code, started_at, ended_at, duration_ms, error '
            'FROM jobs ORDER BY started_at DESC LIMIT ?',
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]