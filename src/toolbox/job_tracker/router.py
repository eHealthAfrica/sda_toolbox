from fastapi import APIRouter, Query

from toolbox.job_tracker.store import get_recent, get_summary

router = APIRouter()


@router.get('/jobs/summary', tags=['Jobs'])
async def jobs_summary() -> dict:
    """Active/Completed/Failed counts across every user of this instance —
    what the frontend Dashboard (src/frontend/src/components/dashboard/
    DashboardPage.tsx) reads instead of its old session-only React tracker.
    """
    return get_summary()


@router.get('/jobs', tags=['Jobs'])
async def jobs_recent(limit: int = Query(20, ge=1, le=200)) -> dict:
    """Most recent job rows (newest first) — not currently rendered by any
    page, kept ready the same way a few other routes in this app are kept
    ready ahead of their frontend (see e.g. submitCombineDmpFiles's comment
    in api/client.ts) in case the Dashboard grows a "recent activity" list.
    """
    return {'jobs': get_recent(limit=limit)}
