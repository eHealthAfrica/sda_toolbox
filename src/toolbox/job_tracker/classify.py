import asyncio
import errno
import hashlib
import os
import traceback
from typing import Mapping, Optional

from toolbox.errors import DataContractError

# What this is: the single place that decides which failure CATEGORY a
# failed job belongs to, so the Reliability page can separate "the platform
# broke" from "the user's file was wrong". The rules are the ones in the
# "Failure capture and categories" section of the Reliability backend spec.
#
#   code_error     any other unhandled exception, or HTTP 500
#   resource       timeouts, out of memory, disk full, HTTP 504
#   dependency     database / network dependency unreachable, HTTP 502/503
#   interrupted    the job was still running when the backend restarted
#   data_contract  the tool rejected the user's data (DataContractError)
#   user_input     a 4xx the caller caused (bad request, wrong type, too big)
#
# The first four COUNT against the success-rate target. The last two are
# reported but excluded; SLO_EXCLUDED_CATEGORIES (comma-separated) changes
# which ones are excluded without a code change.

CATEGORIES = ('code_error', 'resource', 'dependency', 'interrupted', 'data_contract', 'user_input')
DEFAULT_EXCLUDED = ('user_input', 'data_contract')
CATEGORY_HEADER = 'x-error-category'


def excluded_categories() -> tuple[str, ...]:
    raw = os.environ.get('SLO_EXCLUDED_CATEGORIES')
    if raw is None:
        return DEFAULT_EXCLUDED
    return tuple(item.strip() for item in raw.split(',') if item.strip())


def is_counted(category: Optional[str]) -> bool:
    # A failed row with no category (should not happen after the backfill in
    # store.py) is treated as a code error rather than silently dropped from
    # the numbers.
    return (category or 'code_error') not in excluded_categories()


def _class_names(exc: BaseException) -> set[tuple[str, str]]:
    return {(cls.__module__ or '', cls.__name__) for cls in type(exc).__mro__}


def _is_dependency_error(exc: BaseException) -> bool:
    if isinstance(exc, ConnectionError):
        return True
    for module, name in _class_names(exc):
        if module.startswith(('sqlalchemy', 'psycopg2')) and name in ('OperationalError', 'InterfaceError'):
            return True
        if module.startswith(('requests', 'httpx', 'urllib3')) and 'Connect' in name:
            return True
    return False


def _is_resource_error(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, MemoryError)):
        return True
    return isinstance(exc, OSError) and exc.errno == errno.ENOSPC


def classify(
    exc: Optional[BaseException],
    status_code: Optional[int],
    headers: Optional[Mapping[str, str]] = None,
) -> tuple[str, str]:
    """Return (category, error_type) for one failed job.

    `exc` is the exception that escaped the app (None when the app answered
    with an error response instead), `status_code` the HTTP status if one was
    sent, `headers` the response headers lower-cased (only X-Error-Category
    is read).
    """
    if exc is not None:
        error_type = type(exc).__name__
        if isinstance(exc, DataContractError):
            return 'data_contract', error_type
        if _is_resource_error(exc):
            return 'resource', error_type
        if _is_dependency_error(exc):
            return 'dependency', error_type
        return 'code_error', error_type

    error_type = f'HTTP {status_code}' if status_code is not None else 'Unknown'
    declared = (headers or {}).get(CATEGORY_HEADER)
    if declared in CATEGORIES:
        return declared, error_type
    if status_code is not None:
        if 400 <= status_code <= 499:
            return 'user_input', error_type
        if status_code == 504:
            return 'resource', error_type
        if status_code in (502, 503):
            return 'dependency', error_type
    return 'code_error', error_type


def _frames(exc: BaseException) -> list[traceback.FrameSummary]:
    return traceback.extract_tb(exc.__traceback__)[-3:]


def traceback_hash(exc: BaseException) -> Optional[str]:
    """Stable fingerprint of WHERE a crash happened: sha1 of the exception
    type and the innermost three frames (file name, function, line). Two
    runs that die in the same place share a hash, so the Reliability page can
    count them as one cause. File names are reduced to their base name so the
    same crash hashes the same on a laptop and inside the container.
    """
    frames = _frames(exc)
    if not frames:
        return None
    parts = [type(exc).__name__] + [
        f'{os.path.basename(frame.filename)}:{frame.name}:{frame.lineno}' for frame in frames
    ]
    return hashlib.sha1('|'.join(parts).encode('utf-8')).hexdigest()


def describe_exception(exc: BaseException, limit: int = 2000) -> str:
    """Human-readable detail for the Recent failures table: the exception and
    the innermost three frames, trimmed to `limit` characters."""
    lines = [f'{type(exc).__name__}: {exc}']
    for frame in _frames(exc):
        lines.append(f'  at {os.path.basename(frame.filename)}:{frame.lineno} in {frame.name}')
    return '\n'.join(lines)[:limit]
