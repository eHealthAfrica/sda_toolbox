from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from toolbox.job_tracker import health, joblog
from toolbox.utils.upload_limit import max_upload_bytes
from toolbox.job_tracker.incidents import IncidentError
from toolbox.job_tracker.store import (
    get_incidents, get_recent, get_run_by_client_id, get_stats, get_summary, patch_incident,
)

router = APIRouter()

# Notes for anyone adding routes here: none of these paths are in
# middleware.TOOL_ENDPOINTS, so none of them is logged as a job. They are
# plain `def` (not `async def`) where they touch SQLite or the network, so
# FastAPI runs them in its worker threads instead of blocking the event loop.
# /health is the exception: it is `async def` on purpose, so that if the
# event loop is ever blocked it stops answering — which is what a liveness
# probe is for.


@router.get('/jobs/summary', tags=['Jobs'])
async def jobs_summary() -> dict:
    """Active/Completed/Failed counts across every user of this instance —
    what the frontend Dashboard (src/frontend/src/components/dashboard/
    DashboardPage.tsx) reads instead of its old session-only React tracker.
    """
    return get_summary()


@router.get('/jobs/stats', tags=['Reliability'])
def jobs_stats(
    window: str = Query('30d', pattern='^(7d|30d|90d)$'),
    tool: Optional[str] = None,
    include_canary: bool = False,
) -> dict:
    """Success rate against the 95% target, MTTR, per-tool table, failure
    categories, a daily series and the most common crash causes over the
    chosen window. See "SDA Toolbox Reliability: Backend Spec", API contract.
    """
    return get_stats(window=window, tool=tool, include_canary=include_canary)


@router.get('/jobs/{job_id}/logs', tags=['Jobs'])
def job_logs(job_id: str, after: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=2000)) -> dict:
    """Live log lines of a running (or just finished) tool run, for the log
    panel on the tool pages. `job_id` is the id the browser put in the
    X-Client-Job-Id header of the tool request; pass the `next` of the last
    answer as `after` to get only newer lines.

    An id the backend has not seen is a normal answer, not an error: the page
    starts asking before its request has necessarily arrived. It gets
    status 'unknown' and no lines. `stage` is the step the tool last reported
    (the progress bar on the tool pages follows it). Logs are held in memory only (see
    toolbox/job_tracker/joblog.py).
    """
    known = joblog.valid_id(job_id)
    run = get_run_by_client_id(job_id) if known else None
    buffered = joblog.read(job_id, after, limit) if known else None
    if buffered is None:
        buffered = {'lines': [], 'next': after, 'truncated': False}
    return {
        'job_id': job_id,
        'status': run['status'] if run else 'unknown',
        # What the tool last reported it was doing (None before the first report).
        'stage': run['stage'] if run else None,
        'lines': buffered['lines'],
        'next': buffered['next'],
        'truncated': buffered['truncated'],
    }


@router.get('/jobs', tags=['Jobs'])
def jobs_recent(
    limit: int = Query(20, ge=1, le=200),
    status: Optional[str] = Query(None, pattern='^(active|completed|failed)$'),
    tool: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[str] = Query(None, pattern='^(user|canary)$'),
) -> dict:
    """Most recent job rows (newest first), optionally filtered by status,
    tool, failure category or source (user | canary). Each row carries the
    failure reason fields added by the reliability upgrade.
    """
    return {'jobs': get_recent(limit=limit, status=status, tool=tool, category=category, source=source)}


@router.get('/incidents', tags=['Reliability'])
def incidents_list(
    status: str = Query('all', pattern='^(open|acknowledged|resolved|all)$'),
    tool: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    """Incidents, newest first."""
    return {'incidents': get_incidents(status=status, tool=tool, limit=limit)}


class IncidentPatchBody(BaseModel):
    # Plain strings, checked by the store, so a bad value answers 422 with a
    # readable message instead of the app-wide validation handler's 400.
    status: Optional[str] = None
    severity: Optional[str] = None
    resolution: Optional[str] = None
    runbook: Optional[str] = None
    resolved_by: Optional[str] = None


@router.patch('/incidents/{incident_id}', tags=['Reliability'])
def incidents_patch(incident_id: str, body: IncidentPatchBody) -> dict:
    """Acknowledge or resolve an incident, change its severity, or attach a
    resolution note / runbook. Resolving requires a non-empty `resolution`
    (422 otherwise); an unknown id is a 404."""
    try:
        return patch_incident(incident_id, body.model_dump(exclude_unset=True))
    except IncidentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get('/health', tags=['Health'])
async def health_check() -> dict:
    """Liveness only: the process is up and answering. Does no work."""
    return health.liveness()


@router.get('/upload-limit', tags=['Health'])
async def upload_limit() -> dict:
    """The largest request the API accepts (MAX_UPLOAD_MB), so the upload forms can refuse a bigger file up
    front instead of sending it first. `max_upload_bytes` is null when the limit is switched off."""
    limit = max_upload_bytes()
    return {'max_upload_bytes': limit, 'max_upload_mb': None if limit is None else round(limit / (1024 * 1024), 1)}


@router.get('/ready', tags=['Health'])
def ready_check() -> JSONResponse:
    """Readiness: 200 when every critical check passes (status 'ready', or
    'degraded' if a non-critical one fails), 503 when a critical one fails.
    The JSON report is returned either way."""
    report, status_code = health.readiness()
    return JSONResponse(status_code=status_code, content=report)
