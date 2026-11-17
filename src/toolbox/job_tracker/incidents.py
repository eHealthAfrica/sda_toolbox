import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from toolbox.job_tracker.classify import excluded_categories, is_counted

# What this is: the incident log behind the Reliability page — one row per
# "something is broken on this tool" episode, opened and closed from the job
# results themselves so nobody has to remember to file anything.
#
# Lifecycle (see "Failure capture and categories" in the backend spec):
#
#   * A COUNTED failure (code_error / resource / dependency / interrupted)
#     on a tool with no unresolved incident opens one: severity sev3,
#     failure_count 1.
#   * Further counted failures on that tool add to failure_count and move
#     last_job_id; they do not open a second incident.
#   * Two successful runs in a row on the tool close it automatically
#     (resolved_by = 'auto'). Failures that are not counted (a bad upload)
#     are skipped when looking back, since they say nothing about whether the
#     tool works.
#   * A person can acknowledge or resolve it by hand through PATCH
#     /incidents/{id}; resolving needs a written resolution.
#
# Every function takes an open sqlite3 connection from store.py. They do not
# commit; the caller's `with _connect()` block does.

SEVERITIES = ('sev1', 'sev2', 'sev3')
STATUSES = ('open', 'acknowledged', 'resolved')
AUTO_RESOLVE_AFTER = 2

_FIELDS = (
    'id, tool, title, severity, status, error_category, traceback_hash, opened_at, '
    'acknowledged_at, resolved_at, resolved_by, resolution, runbook, failure_count, '
    'first_job_id, last_job_id'
)


class IncidentError(Exception):
    """A rejected incident update; the router turns it into an HTTP error."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seconds_between(start: Optional[str], end: datetime) -> Optional[int]:
    if not start:
        return None
    try:
        return max(0, int((end - datetime.fromisoformat(start)).total_seconds()))
    except ValueError:
        return None


def _to_dict(row: sqlite3.Row, now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    incident = dict(row)
    if incident['status'] == 'resolved':
        incident['age_seconds'] = None
        resolved_at = incident.get('resolved_at')
        try:
            end = datetime.fromisoformat(resolved_at) if resolved_at else None
        except ValueError:
            end = None
        incident['duration_seconds'] = _seconds_between(incident['opened_at'], end) if end else None
    else:
        incident['age_seconds'] = _seconds_between(incident['opened_at'], now)
        incident['duration_seconds'] = None
    return incident


def _unresolved_for_tool(conn: sqlite3.Connection, tool: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        f"SELECT {_FIELDS} FROM incidents WHERE tool = ? AND status != 'resolved' "
        'ORDER BY opened_at DESC LIMIT 1',
        (tool,),
    ).fetchone()


def on_job_finished(conn: sqlite3.Connection, job_id: str) -> Optional[dict[str, Any]]:
    """Open, extend or auto-resolve an incident because job `job_id` just
    finished. Called from store.finish_job after the job row is saved.

    Returns what happened, for the notifier (alerts.py): None when nothing
    changed, otherwise {'event': 'opened' | 'extended' | 'resolved', ...} with
    the incident id and the tool, label, category and error type involved."""
    # Serialises concurrent finishers: without it two simultaneous failures
    # on one tool could each see "no open incident" and open two.
    conn.execute('BEGIN IMMEDIATE')
    conn.row_factory = sqlite3.Row
    job = conn.execute(
        'SELECT id, tool, label, status, error_category, error_type, traceback_hash '
        'FROM jobs WHERE id = ?',
        (job_id,),
    ).fetchone()
    if job is None:
        return None

    def event(kind: str, incident_id: str) -> dict[str, Any]:
        return {'event': kind, 'incident_id': incident_id, 'tool': job['tool'], 'label': job['label'],
                'error_category': job['error_category'], 'error_type': job['error_type']}

    if job['status'] == 'failed':
        if not is_counted(job['error_category']):
            return None
        open_incident = _unresolved_for_tool(conn, job['tool'])
        if open_incident is not None:
            conn.execute(
                'UPDATE incidents SET failure_count = failure_count + 1, last_job_id = ? WHERE id = ?',
                (job['id'], open_incident['id']),
            )
            return event('extended', open_incident['id'])
        what = job['error_type'] or job['error_category'] or 'failure'
        incident_id = str(uuid.uuid4())
        conn.execute(
            'INSERT INTO incidents (id, tool, title, severity, status, error_category, traceback_hash, '
            'opened_at, failure_count, first_job_id, last_job_id) '
            "VALUES (?, ?, ?, 'sev3', 'open', ?, ?, ?, 1, ?, ?)",
            (
                incident_id, job['tool'], f"{job['label']}: {what}",
                job['error_category'], job['traceback_hash'], _now(), job['id'], job['id'],
            ),
        )
        return event('opened', incident_id)

    if job['status'] == 'completed':
        open_incident = _unresolved_for_tool(conn, job['tool'])
        if open_incident is None:
            return None
        excluded = excluded_categories()
        placeholders = ','.join('?' for _ in excluded) or "''"
        recent = conn.execute(
            "SELECT status FROM jobs WHERE tool = ? AND status IN ('completed', 'failed') "
            f"AND NOT (status = 'failed' AND COALESCE(error_category, 'code_error') IN ({placeholders})) "
            'ORDER BY ended_at DESC, rowid DESC LIMIT ?',
            (job['tool'], *excluded, AUTO_RESOLVE_AFTER),
        ).fetchall()
        if len(recent) == AUTO_RESOLVE_AFTER and all(r['status'] == 'completed' for r in recent):
            now = _now()
            conn.execute(
                "UPDATE incidents SET status = 'resolved', resolved_at = ?, resolved_by = 'auto', "
                'resolution = ? WHERE id = ?',
                (now, f'Auto-resolved: {AUTO_RESOLVE_AFTER} successful runs in a row.', open_incident['id']),
            )
            return event('resolved', open_incident['id'])
    return None


def get_incident(conn: sqlite3.Connection, incident_id: str) -> Optional[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    row = conn.execute(f'SELECT {_FIELDS} FROM incidents WHERE id = ?', (incident_id,)).fetchone()
    return _to_dict(row) if row else None


def list_incidents(
    conn: sqlite3.Connection,
    status: str = 'all',
    tool: Optional[str] = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    where, params = [], []
    if status != 'all':
        where.append('status = ?')
        params.append(status)
    if tool:
        where.append('tool = ?')
        params.append(tool)
    clause = f"WHERE {' AND '.join(where)}" if where else ''
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        f'SELECT {_FIELDS} FROM incidents {clause} ORDER BY opened_at DESC, rowid DESC LIMIT ?',
        (*params, limit),
    ).fetchall()
    now = datetime.now(timezone.utc)
    return [_to_dict(row, now) for row in rows]


def update_incident(
    conn: sqlite3.Connection, incident_id: str, patch: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Apply a manual change. Raises IncidentError(404/409/422) for a bad
    request; returns (updated incident, True if this call resolved it)."""
    conn.execute('BEGIN IMMEDIATE')
    conn.row_factory = sqlite3.Row
    current = conn.execute(f'SELECT {_FIELDS} FROM incidents WHERE id = ?', (incident_id,)).fetchone()
    if current is None:
        raise IncidentError(404, f'No incident with id {incident_id}.')

    updates: dict[str, Any] = {}
    status = patch.get('status')
    severity = patch.get('severity')

    if severity is not None:
        if severity not in SEVERITIES:
            raise IncidentError(422, f"severity must be one of: {', '.join(SEVERITIES)}.")
        updates['severity'] = severity

    if 'runbook' in patch and patch['runbook'] is not None:
        updates['runbook'] = str(patch['runbook']).strip()[:500] or None

    resolution = patch.get('resolution')
    if resolution is not None:
        updates['resolution'] = str(resolution).strip()[:2000] or None

    if status is not None:
        if status not in ('acknowledged', 'resolved'):
            raise IncidentError(422, "status can only be changed to 'acknowledged' or 'resolved'.")
        if status == 'acknowledged':
            if current['status'] == 'resolved':
                raise IncidentError(409, 'This incident is already resolved.')
            if current['status'] == 'open':
                updates['status'] = 'acknowledged'
                updates['acknowledged_at'] = _now()
        else:
            final_resolution = updates['resolution'] if 'resolution' in updates else current['resolution']
            if not final_resolution or not final_resolution.strip():
                raise IncidentError(422, 'A resolution note is required to resolve an incident.')
            if current['status'] != 'resolved':
                updates['status'] = 'resolved'
                updates['resolved_at'] = _now()
                resolved_by = patch.get('resolved_by')
                updates['resolved_by'] = (str(resolved_by).strip()[:100] if resolved_by else None) or 'manual'

    if updates:
        assignments = ', '.join(f'{column} = ?' for column in updates)
        conn.execute(f'UPDATE incidents SET {assignments} WHERE id = ?', (*updates.values(), incident_id))

    updated = conn.execute(f'SELECT {_FIELDS} FROM incidents WHERE id = ?', (incident_id,)).fetchone()
    return _to_dict(updated), updates.get('status') == 'resolved'
