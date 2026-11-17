import logging
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Optional

from toolbox.job_tracker.context import current_client_job_id

# What this is: the live log a tool page shows while its job is still running.
#
# How it fits together (see "Live job logs" in the Reliability backend spec):
#
#   * The browser makes up a job id (a UUID) before it sends a tool's request
#     and sends it in the X-Client-Job-Id header. JobLoggingMiddleware reads it,
#     calls register() here, and sets the `current_client_job_id` context
#     variable for the length of the request.
#   * JobLogHandler sits on the root logger. Every log record written while a
#     request carrying that header is running is copied into a small in-memory
#     buffer for that job. Records from other requests, and from background
#     work with no job, are ignored.
#   * GET /jobs/{id}/logs (router.py) reads the buffer; the page polls it with
#     the sequence number of the last line it has.
#
# Limits worth knowing:
#
#   * The buffer is in this process's memory. That is right for the way the app
#     runs (one uvicorn process); with several workers a poll could land on a
#     worker that does not hold the job. It is not saved: a restart empties it.
#   * Only `logging` calls show up. print() and tqdm progress bars write to the
#     console, not to the logging system, so they do not appear.
#   * Context variables follow the request into FastAPI's worker threads and
#     asyncio.to_thread, but NOT into a plain ThreadPoolExecutor or a
#     ProcessPoolExecutor. Log lines written inside those pools are not tied
#     to the job and are not captured.
#   * Memory is capped: MAX_LINES per job (older lines are dropped and the
#     response says `truncated`), MAX_JOBS jobs at once, and a finished job's
#     buffer is dropped RETENTION seconds after it ends.

logger = logging.getLogger(__name__)


def _env_number(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


MAX_LINES = int(_env_number('JOB_LOG_MAX_LINES', 2000))
MAX_JOBS = int(_env_number('JOB_LOG_MAX_JOBS', 50))
RETENTION_SECONDS = _env_number('JOB_LOG_RETENTION_MINUTES', 30) * 60
MAX_LINE_CHARS = 1000

_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
# JobIdFilter (context.py) puts this in front of every line; the panel already
# knows which job it is looking at.
_JOB_STAMP = re.compile(r'^\[job=[0-9a-f]{8}\] ')


class _JobLog:
    __slots__ = ('lines', 'next_seq', 'finished_at')

    def __init__(self) -> None:
        self.lines: deque = deque(maxlen=MAX_LINES)
        self.next_seq = 1
        self.finished_at: Optional[float] = None


_logs: dict[str, _JobLog] = {}
_lock = threading.Lock()


def valid_id(job_id: Optional[str]) -> bool:
    return bool(job_id) and bool(_UUID.match(job_id))  # type: ignore[arg-type]


def _purge_locked(now: float) -> None:
    expired = [key for key, log in _logs.items() if log.finished_at is not None and now - log.finished_at > RETENTION_SECONDS]
    for key in expired:
        del _logs[key]


def register(job_id: str) -> bool:
    """Start a buffer for `job_id`. False when the id is not a UUID or is
    already in use (a second request must not write into, or read, another
    run's log), in which case the request simply runs without live logs."""
    if not valid_id(job_id):
        return False
    with _lock:
        now = time.time()
        _purge_locked(now)
        if job_id in _logs:
            return False
        while len(_logs) >= MAX_JOBS:
            # Make room: oldest finished job first, otherwise the oldest of all.
            victim = next((k for k, v in _logs.items() if v.finished_at is not None), next(iter(_logs)))
            del _logs[victim]
        _logs[job_id] = _JobLog()
        return True


def mark_finished(job_id: Optional[str]) -> None:
    if not job_id:
        return
    with _lock:
        log = _logs.get(job_id)
        if log is not None and log.finished_at is None:
            log.finished_at = time.time()


def append(job_id: str, level: str, message: str, created: Optional[float] = None) -> None:
    stamp = datetime.fromtimestamp(created if created is not None else time.time(), timezone.utc).isoformat()
    with _lock:
        log = _logs.get(job_id)
        if log is None:
            return
        log.lines.append({'seq': log.next_seq, 'ts': stamp, 'level': level, 'message': message[:MAX_LINE_CHARS]})
        log.next_seq += 1


def read(job_id: str, after: int = 0, limit: int = 500) -> Optional[dict[str, Any]]:
    """Lines with seq > `after`, oldest first (at most `limit`). None when this
    id has no buffer (never registered, evicted, or expired)."""
    with _lock:
        _purge_locked(time.time())
        log = _logs.get(job_id)
        if log is None:
            return None
        after = max(0, after)
        oldest = log.lines[0]['seq'] if log.lines else log.next_seq
        fresh = [line for line in log.lines if line['seq'] > after][:max(1, limit)]
        return {
            'lines': fresh,
            'next': fresh[-1]['seq'] if fresh else after,
            # Lines between the caller's cursor and the oldest one kept were dropped.
            'truncated': oldest > after + 1,
        }


def reset() -> None:
    """Forget everything (used by tests)."""
    with _lock:
        _logs.clear()


class JobLogHandler(logging.Handler):
    """Copies each log record into the buffer of the job being served."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            job_id = current_client_job_id.get()
            if not job_id:
                return
            message = _JOB_STAMP.sub('', record.getMessage())
            exc = record.exc_info[1] if record.exc_info else None
            if exc is not None:
                message += f' [{type(exc).__name__}: {exc}]'
            append(job_id, record.levelname, message, record.created)
        except Exception:
            # Logging must never fail because of the live-log copy.
            pass


def install_log_handler() -> None:
    """Attach JobLogHandler to the root logger (idempotent)."""
    root = logging.getLogger()
    if not any(isinstance(h, JobLogHandler) for h in root.handlers):
        root.addHandler(JobLogHandler())
