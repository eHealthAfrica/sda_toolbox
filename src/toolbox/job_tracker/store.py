import logging
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from toolbox.utils import workspace
from toolbox.job_tracker import alerts, incidents, stats

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
#
# Reliability upgrade: each finished job now also records WHY it failed
# (category, error type, a short detail, a fingerprint of where it crashed),
# whether it was a real user job or a synthetic check, and how far it got.
# An `incidents` table turns repeated failures into one tracked episode. The
# schema change is applied by _migrate() below, which adds only the columns
# an existing jobs.sqlite3 is missing, so upgrading never needs a manual
# step and never loses history.

logger = logging.getLogger(__name__)

DB_ENV_VAR = 'JOBS_DB_PATH'
ERROR_DETAIL_LIMIT = 2000
DATA_WARNING_LIMIT = 500


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

CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'sev3',
    status TEXT NOT NULL DEFAULT 'open',
    error_category TEXT,
    traceback_hash TEXT,
    opened_at TEXT NOT NULL,
    acknowledged_at TEXT,
    resolved_at TEXT,
    resolved_by TEXT,
    resolution TEXT,
    runbook TEXT,
    failure_count INTEGER NOT NULL DEFAULT 1,
    first_job_id TEXT,
    last_job_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

CREATE TABLE IF NOT EXISTS alerts_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    channels TEXT NOT NULL DEFAULT '',
    summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_sent_lookup ON alerts_sent(rule, tool, key, sent_at);
"""

# Columns added to `jobs` by the reliability upgrade. SQLite has no
# "ADD COLUMN IF NOT EXISTS", so _migrate() checks PRAGMA table_info first.
_NEW_JOB_COLUMNS = {
    'error_category': 'TEXT',
    'error_type': 'TEXT',
    'error_detail': 'TEXT',
    'traceback_hash': 'TEXT',
    'stage': 'TEXT',
    'source': "TEXT NOT NULL DEFAULT 'user'",
    'input_bytes': 'INTEGER',
    # Set when the job finished fine but its data looked wrong (toolbox/dataops).
    'data_warning': 'TEXT',
    # The id the browser chose for this run; the live log is looked up by it (joblog.py).
    'client_job_id': 'TEXT',
}

_JOB_COLUMNS = (
    'id, tool, label, method, path, status, status_code, started_at, ended_at, duration_ms, error, '
    'error_category, error_type, error_detail, traceback_hash, stage, source, input_bytes, data_warning'
)


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


# Public name for the other modules in this package (health.py).
connect = _connect


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute('PRAGMA table_info(jobs)')}
    for name, ddl in _NEW_JOB_COLUMNS.items():
        if name in existing:
            continue
        try:
            conn.execute(f'ALTER TABLE jobs ADD COLUMN {name} {ddl}')
        except sqlite3.OperationalError as exc:
            # Two workers starting together can both see the column missing;
            # the loser's ALTER fails with "duplicate column name", which
            # means the column is there and is fine.
            if 'duplicate column' not in str(exc).lower():
                raise

    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_tool_started ON jobs(tool, started_at)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(error_category)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_client_job_id ON jobs(client_job_id)')

    # One-off for history written before categories existed: give every failed
    # row a category from what we do know. Safe to run every start-up — it only
    # touches rows still missing one. HTTP 504 / 502 / 503 follow the same
    # mapping classify.py uses for live failures.
    conn.execute(
        """
        UPDATE jobs SET error_category = CASE
            WHEN status_code BETWEEN 400 AND 499 THEN 'user_input'
            WHEN status_code = 504 THEN 'resource'
            WHEN status_code IN (502, 503) THEN 'dependency'
            WHEN error LIKE 'interrupted%' THEN 'interrupted'
            ELSE 'code_error'
        END
        WHERE status = 'failed' AND error_category IS NULL
        """
    )


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)
        _migrate(conn)


def _reconcile_stale_active_jobs() -> None:
    # Any row still 'active' at process start is, by definition, a request
    # that never got to finish in a process that no longer exists — the only
    # way that happens is the backend restarting (or crashing) mid-request.
    # That's exactly the shape of the "have to restart after an intensive
    # spatial run" issue reported separately — without this sweep, a job
    # caught by that restart would show as a permanent ghost "Active" count
    # on the Dashboard until the heat death of the universe. Runs once at
    # import time, before anything else can INSERT a fresh 'active' row.
    #
    # These rows are filed under the `interrupted` category, which counts
    # against the success rate and opens (or adds to) an incident for the
    # tool, so a restart that kills a running job is visible on the
    # Reliability page.
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        stale_ids = [row[0] for row in conn.execute("SELECT id FROM jobs WHERE status = 'active'")]
        conn.execute(
            "UPDATE jobs SET status = 'failed', ended_at = ?, error = ?, error_category = 'interrupted', "
            "error_type = 'Interrupted' WHERE status = 'active'",
            (now, 'interrupted — backend restarted or crashed while this job was running'),
        )
    for job_id in stale_ids:
        _update_incidents(job_id)


def _update_incidents(job_id: str) -> None:
    # Incident bookkeeping is best-effort: the job row is already saved, and
    # a problem here must never turn a finished request into an error. Any
    # alert it triggers is queued on a worker thread (alerts.py) and has its
    # own try/except, so it cannot either.
    try:
        with _connect() as conn:
            event = incidents.on_job_finished(conn, job_id)
    except Exception:
        logger.exception('job tracker: could not update incidents for job %s', job_id)
        return
    if event:
        alerts.handle_incident_event(event)


init_db()
_reconcile_stale_active_jobs()


def start_job(
    tool: str,
    label: str,
    method: str,
    path: str,
    client_host: Optional[str],
    source: str = 'user',
    input_bytes: Optional[int] = None,
    client_job_id: Optional[str] = None,
) -> str:
    job_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            'INSERT INTO jobs (id, tool, label, method, path, status, client_host, started_at, source, input_bytes, '
            'client_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (job_id, tool, label, method, path, 'active', client_host, started_at, source, input_bytes, client_job_id),
        )
    return job_id


def get_status_by_client_id(client_job_id: str) -> Optional[str]:
    """'active' | 'completed' | 'failed' for the run the browser tagged with
    this id, or None when no such run has been recorded (yet)."""
    with _connect() as conn:
        row = conn.execute(
            'SELECT status FROM jobs WHERE client_job_id = ? ORDER BY started_at DESC LIMIT 1', (client_job_id,)
        ).fetchone()
    return row[0] if row else None


def get_run_by_client_id(client_job_id: str) -> Optional[dict]:
    """{'status': 'active' | 'completed' | 'failed', 'stage': str | None} for the
    run the browser tagged with this id, or None when no such run is recorded.
    `stage` is the last thing the tool reported with report_stage()."""
    with _connect() as conn:
        row = conn.execute(
            'SELECT status, stage FROM jobs WHERE client_job_id = ? ORDER BY started_at DESC LIMIT 1', (client_job_id,)
        ).fetchone()
    return {'status': row[0], 'stage': row[1]} if row else None


def set_stage(job_id: str, stage: str) -> None:
    with _connect() as conn:
        conn.execute('UPDATE jobs SET stage = ? WHERE id = ?', (stage[:100], job_id))


def finish_job(
    job_id: str,
    status: str,
    status_code: Optional[int],
    error: Optional[str] = None,
    *,
    error_category: Optional[str] = None,
    error_type: Optional[str] = None,
    error_detail: Optional[str] = None,
    traceback_hash: Optional[str] = None,
    data_warning: Optional[str] = None,
) -> None:
    ended_at = datetime.now(timezone.utc).isoformat()
    if error_detail is not None:
        error_detail = error_detail[:ERROR_DETAIL_LIMIT]
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
            'UPDATE jobs SET status = ?, status_code = ?, ended_at = ?, duration_ms = ?, error = ?, '
            'error_category = ?, error_type = ?, error_detail = ?, traceback_hash = ?, data_warning = ? WHERE id = ?',
            (status, status_code, ended_at, duration_ms, error,
             error_category, error_type, error_detail, traceback_hash,
             data_warning[:DATA_WARNING_LIMIT] if data_warning else None, job_id),
        )
    _update_incidents(job_id)


def get_summary() -> dict:
    with _connect() as conn:
        rows = conn.execute('SELECT status, COUNT(*) FROM jobs GROUP BY status').fetchall()
    counts = {'active': 0, 'completed': 0, 'failed': 0}
    for status, count in rows:
        if status in counts:
            counts[status] = count
    counts['total'] = sum(counts.values())
    return counts


def get_recent(
    limit: int = 20,
    status: Optional[str] = None,
    tool: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[str] = None,
) -> list[dict]:
    limit = max(1, min(limit, 200))
    where, params = [], []
    for column, value in (('status', status), ('tool', tool), ('error_category', category), ('source', source)):
        if value:
            where.append(f'{column} = ?')
            params.append(value)
    clause = f"WHERE {' AND '.join(where)}" if where else ''
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f'SELECT {_JOB_COLUMNS} FROM jobs {clause} ORDER BY started_at DESC LIMIT ?',
            (*params, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def get_stats(window: str = '30d', tool: Optional[str] = None, include_canary: bool = False) -> dict[str, Any]:
    with _connect() as conn:
        return stats.compute_stats(conn, window=window, tool=tool, include_canary=include_canary)


def get_incidents(status: str = 'all', tool: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
    with _connect() as conn:
        return incidents.list_incidents(conn, status=status, tool=tool, limit=limit)


def patch_incident(incident_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    with _connect() as conn:
        incident, resolved_now = incidents.update_incident(conn, incident_id, patch)
    if resolved_now:
        alerts.notify_resolved(incident_id)
    return incident
