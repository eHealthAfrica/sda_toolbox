import math
import os
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from toolbox.job_tracker.classify import is_counted

# What this is: the numbers behind GET /jobs/stats and the Reliability page.
#
# Definitions (from the Reliability backend spec):
#   success rate  = completed / (completed + counted failures), over the
#                   chosen window, user jobs only unless include_canary.
#   counted       = failure categories code_error, resource, dependency,
#                   interrupted. user_input and data_contract are reported
#                   but excluded (SLO_EXCLUDED_CATEGORIES changes that).
#   MTTR          = mean of (resolved_at - opened_at) over incidents
#                   resolved inside the window, shown with median and p90.
#   window        = the last N whole UTC calendar days including today, so
#                   "30d" is exactly 30 daily bars on the chart.
#   p50/p95       = of the run time of COMPLETED jobs in the window.
#
# The window's jobs are read once and summed in Python. A 90-day window on
# this instance is a few thousand rows at most, and keeping the arithmetic
# in one readable place beats five hand-tuned SQL aggregates.

WINDOWS = {'7d': 7, '30d': 30, '90d': 90}
DEFAULT_TARGET = 0.95
TOP_CAUSES_LIMIT = 10


def _target() -> float:
    try:
        value = float(os.environ.get('SLO_TARGET', DEFAULT_TARGET))
    except ValueError:
        return DEFAULT_TARGET
    return value if 0 < value <= 1 else DEFAULT_TARGET


def _rate(completed: int, failed_counted: int) -> Optional[float]:
    denominator = completed + failed_counted
    return round(completed / denominator, 6) if denominator else None


def _percentile(values: list[float], fraction: float) -> Optional[int]:
    """Nearest-rank percentile: the smallest value with at least `fraction`
    of the data at or below it."""
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return int(round(ordered[index]))


def _mean(values: list[float]) -> Optional[int]:
    return int(round(sum(values) / len(values))) if values else None


def _first_line(text: Optional[str], limit: int = 200) -> Optional[str]:
    if not text:
        return None
    return text.strip().splitlines()[0][:limit] if text.strip() else None


def _seconds(start: str, end: str) -> Optional[float]:
    try:
        return max(0.0, (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds())
    except ValueError:
        return None


def compute_stats(
    conn: sqlite3.Connection,
    window: str = '30d',
    tool: Optional[str] = None,
    include_canary: bool = False,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    if window not in WINDOWS:
        raise ValueError(f'window must be one of: {", ".join(WINDOWS)}')
    days = WINDOWS[window]
    now = now or datetime.now(timezone.utc)
    first_day = now.date() - timedelta(days=days - 1)
    start = datetime(first_day.year, first_day.month, first_day.day, tzinfo=timezone.utc)

    conn.row_factory = sqlite3.Row

    where = ["status != 'active'", 'started_at >= ?']
    params: list[Any] = [start.isoformat()]
    if tool:
        where.append('tool = ?')
        params.append(tool)
    if not include_canary:
        where.append("source = 'user'")
    rows = conn.execute(
        'SELECT tool, label, status, error_category, error_type, error_detail, error, traceback_hash, '
        'started_at, ended_at, duration_ms '
        f"FROM jobs WHERE {' AND '.join(where)} ORDER BY started_at ASC",
        params,
    ).fetchall()

    # --- per-job pass --------------------------------------------------
    overall = Counter()
    durations: list[float] = []
    by_tool: dict[str, dict[str, Any]] = {}
    by_category: Counter = Counter()
    daily: dict[str, Counter] = {
        (first_day + timedelta(days=offset)).isoformat(): Counter() for offset in range(days)
    }
    causes: dict[str, dict[str, Any]] = {}

    for row in rows:
        entry = by_tool.setdefault(
            row['tool'],
            {'tool': row['tool'], 'label': row['label'], 'total': 0, 'completed': 0, 'failed_counted': 0,
             'failed_excluded': 0, 'durations': [], 'last_failure_at': None},
        )
        entry['label'] = row['label']  # rows are oldest-first, so the newest label wins
        entry['total'] += 1
        overall['total'] += 1
        day = daily.get(row['started_at'][:10])

        if row['status'] == 'completed':
            overall['completed'] += 1
            entry['completed'] += 1
            if day is not None:
                day['completed'] += 1
            if row['duration_ms'] is not None:
                durations.append(row['duration_ms'])
                entry['durations'].append(row['duration_ms'])
            continue

        category = row['error_category'] or 'code_error'
        by_category[category] += 1
        if not is_counted(category):
            overall['failed_excluded'] += 1
            entry['failed_excluded'] += 1
            if day is not None:
                day['failed_excluded'] += 1
            continue

        overall['failed_counted'] += 1
        entry['failed_counted'] += 1
        if day is not None:
            day['failed_counted'] += 1
        seen = row['ended_at'] or row['started_at']
        if entry['last_failure_at'] is None or seen > entry['last_failure_at']:
            entry['last_failure_at'] = seen

        error_type = row['error_type'] or (row['error'] or 'Unknown')[:60]
        key = row['traceback_hash'] or f"{row['tool']}|{error_type}"
        cause = causes.setdefault(
            key,
            {'traceback_hash': row['traceback_hash'], 'error_type': row['error_type'], 'sample': None,
             'tool': row['tool'], 'category': category, 'count': 0, 'last_seen': seen},
        )
        cause['count'] += 1
        if seen >= cause['last_seen']:
            cause.update(last_seen=seen, tool=row['tool'], category=category,
                         sample=_first_line(row['error_detail'] or row['error']))

    # --- incidents -----------------------------------------------------
    inc_where, inc_params = ["status != 'resolved'"], []
    if tool:
        inc_where.append('tool = ?')
        inc_params.append(tool)
    open_rows = conn.execute(
        f"SELECT tool, id FROM incidents WHERE {' AND '.join(inc_where)} ORDER BY opened_at ASC",
        inc_params,
    ).fetchall()
    open_by_tool = {r['tool']: r['id'] for r in open_rows}  # newest unresolved wins

    res_where, res_params = ["status = 'resolved'", 'resolved_at >= ?'], [start.isoformat()]
    if tool:
        res_where.append('tool = ?')
        res_params.append(tool)
    resolved_rows = conn.execute(
        f"SELECT opened_at, resolved_at FROM incidents WHERE {' AND '.join(res_where)}", res_params
    ).fetchall()
    repair_seconds = [
        s for s in (_seconds(r['opened_at'], r['resolved_at']) for r in resolved_rows) if s is not None
    ]

    # --- assemble ------------------------------------------------------
    tools_out = []
    for entry in by_tool.values():
        tools_out.append({
            'tool': entry['tool'],
            'label': entry['label'],
            'total': entry['total'],
            'completed': entry['completed'],
            'failed_counted': entry['failed_counted'],
            'failed_excluded': entry['failed_excluded'],
            'success_rate': _rate(entry['completed'], entry['failed_counted']),
            'p95_ms': _percentile(entry['durations'], 0.95),
            'last_failure_at': entry['last_failure_at'],
            'open_incident_id': open_by_tool.get(entry['tool']),
        })
    tools_out.sort(key=lambda t: (-t['failed_counted'], -t['total'], t['tool']))

    categories_out = [
        {'category': name, 'count': count, 'counted': is_counted(name)}
        for name, count in sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    daily_out = [
        {
            'date': date,
            'completed': c['completed'],
            'failed_counted': c['failed_counted'],
            'failed_excluded': c['failed_excluded'],
            'success_rate': _rate(c['completed'], c['failed_counted']),
        }
        for date, c in daily.items()
    ]

    # Most frequent first; among equals, the most recently seen first.
    top_causes = sorted(causes.values(), key=lambda c: c['last_seen'], reverse=True)
    top_causes.sort(key=lambda c: -c['count'])
    top_causes = top_causes[:TOP_CAUSES_LIMIT]

    return {
        'window': {'from': start.isoformat(), 'to': now.isoformat(), 'days': days},
        'target': {'success_rate': _target()},
        'overall': {
            'total': overall['total'],
            'completed': overall['completed'],
            'failed_counted': overall['failed_counted'],
            'failed_excluded': overall['failed_excluded'],
            'success_rate': _rate(overall['completed'], overall['failed_counted']),
            'p50_ms': _percentile(durations, 0.50),
            'p95_ms': _percentile(durations, 0.95),
            'mttr_seconds': _mean(repair_seconds),
            'mttr_median_seconds': _percentile(repair_seconds, 0.50),
            'mttr_p90_seconds': _percentile(repair_seconds, 0.90),
            'resolved_incidents': len(repair_seconds),
            'open_incidents': len(open_rows),
        },
        'by_tool': tools_out,
        'by_category': categories_out,
        'daily': daily_out,
        'top_causes': top_causes,
    }

