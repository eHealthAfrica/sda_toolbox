"""In-memory bridge between POST /tracking/gridded's fast CSV-only response
and GET /tracking/gridded/archive/{job_id}'s full ZIP (settlements CSV +
tracks GeoPackage + optional reports) — see h2h_validation.py for the full
rationale: settlement_tracking() already has both the settlements DataFrame
and the tracks GeoDataFrame in memory by the time it returns (they come out
of the same assess_grid_visitation() call). The only genuinely slow step
left is serializing the tracks GeoDataFrame to a GeoPackage
(export_mgr.add_to_archive -> create_spatial_sqlite), which happens inside
the ZIP-building loop — not while the settlements CSV is being produced. So
the fast route hands the CSV back immediately and stashes everything the
archive route needs to build the ZIP later, without re-running
settlement_tracking() (and therefore without re-reading/re-processing the
uploaded tracks file) a second time.

Deliberately a plain in-process dict — this mirrors the size/complexity of
this app's other in-memory state (job_tracker's dashboard store is a real
SQLite file, but the pattern of "one process, no external cache service" is
the same). If this app ever runs with multiple worker processes, both this
cache and job_tracker would need to move to shared storage; every route in
this package already assumes a single process.
"""

import io
import time
import uuid
import threading
from dataclasses import dataclass

import pandas as pd
import geopandas as gpd

# Unclaimed results are dropped after this long, so a run nobody ever
# downloads doesn't hold its DataFrames in memory forever.
TTL_SECONDS = 30 * 60

_lock = threading.Lock()
_cache: dict[str, 'CachedResult'] = {}


@dataclass
class CachedResult:
    settlements: pd.DataFrame
    tracks: gpd.GeoDataFrame
    reports: io.BytesIO | None
    analysis_day: int
    dip_filename: str
    stored_at: float


def _sweep_expired_locked() -> None:
    """Caller must hold _lock. Drops any entry older than TTL_SECONDS."""
    cutoff = time.time() - TTL_SECONDS
    stale_ids = [job_id for job_id, entry in _cache.items() if entry.stored_at < cutoff]
    for job_id in stale_ids:
        _cache.pop(job_id, None)


def store_result(
    settlements: pd.DataFrame,
    tracks: gpd.GeoDataFrame,
    reports: io.BytesIO | None,
    analysis_day: int,
    dip_filename: str,
) -> str:
    """Stashes one run's data and returns a fresh job id for it."""
    job_id = uuid.uuid4().hex
    with _lock:
        _sweep_expired_locked()
        _cache[job_id] = CachedResult(
            settlements=settlements,
            tracks=tracks,
            reports=reports,
            analysis_day=analysis_day,
            dip_filename=dip_filename,
            stored_at=time.time(),
        )
    return job_id


def pop_result(job_id: str) -> CachedResult | None:
    """Removes and returns the cached result for job_id, or None if it was
    never stored, already claimed by an earlier archive download, or has
    expired. One successful archive download consumes the entry — the same
    "read once" lifecycle the TTL sweep enforces on a slower timescale for
    results nobody ever downloads."""
    with _lock:
        _sweep_expired_locked()
        return _cache.pop(job_id, None)
