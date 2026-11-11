"""Result files that are deleted once they have been sent.

Routes that return a generated CSV used to write it with
``NamedTemporaryFile(delete=False)`` and never remove it, so the temp
directory grew with every run. The helpers here put those files in one
folder, delete each one after its response has been sent, and sweep up
anything older than ``TEMP_FILE_MAX_AGE_HOURS`` (default 6) as a safety
net for downloads that were cut off before the delete ran.

Typical use in an ``async def`` route - ``afile_response`` does all of the below in one call
(``file_response`` is the same for plain ``def`` code)::

    return await afile_response(lambda path: df.to_csv(path, index=False),
                                '.csv', 'text/csv', 'my result.csv')

which is shorthand for::

    path = new_result_file('.csv')
    try:
        df.to_csv(path, index=False)
    except Exception:
        remove_file(path)
        raise
    return FileResponse(path, media_type='text/csv', filename='my result.csv',
                        background=delete_after_response(path))
"""
import logging
import os
import tempfile
import time
from typing import Callable, Optional

from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

RESULT_DIR = os.path.join(tempfile.gettempdir(), 'sda-toolbox-results')
DEFAULT_MAX_AGE_HOURS = 6.0

_log = logging.getLogger(__name__)


def _max_age_seconds() -> float:
    raw = os.environ.get('TEMP_FILE_MAX_AGE_HOURS')
    try:
        hours = float(raw) if raw not in (None, '') else DEFAULT_MAX_AGE_HOURS
    except ValueError:
        hours = DEFAULT_MAX_AGE_HOURS
    return max(hours, 0.0) * 3600


def remove_file(path: str) -> None:
    """Delete `path`; a file that is already gone is fine, other errors are logged."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as exc:
        _log.warning('Could not delete temporary file %s: %s', path, exc)


def sweep_stale(max_age_seconds: Optional[float] = None) -> int:
    """Delete result files older than the limit; returns how many were removed."""
    limit = _max_age_seconds() if max_age_seconds is None else max_age_seconds
    cutoff = time.time() - limit
    removed = 0
    try:
        names = os.listdir(RESULT_DIR)
    except OSError:
        return 0
    for name in names:
        path = os.path.join(RESULT_DIR, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            continue
    return removed


def new_result_file(suffix: str = '.csv') -> str:
    """Create an empty file in the results folder and return its path."""
    os.makedirs(RESULT_DIR, exist_ok=True)
    sweep_stale()
    fd, path = tempfile.mkstemp(suffix=suffix, dir=RESULT_DIR)
    os.close(fd)
    return path


def delete_after_response(path: str) -> BackgroundTask:
    """A background task for ``FileResponse(background=...)`` that deletes `path`."""
    return BackgroundTask(remove_file, path)


def file_response(write: Callable[[str], None], suffix: str, media_type: str, filename: str) -> FileResponse:
    """Write a result with ``write(path)`` and return it as a download that deletes itself.

    `write` receives the path of a new empty file in the results folder (a lambda around
    ``df.to_csv`` or a small function that fills an ``ExcelWriter``). If it raises, the
    half-written file is removed and the error propagates unchanged; otherwise the file is
    deleted once the response has been sent.
    """
    path = new_result_file(suffix)
    try:
        write(path)
    except BaseException:
        remove_file(path)
        raise
    return _download(path, media_type, filename)


async def afile_response(write: Callable[[str], None], suffix: str, media_type: str, filename: str) -> FileResponse:
    """``file_response`` for use inside ``async def`` routes: ``await afile_response(...)``.

    Writing a large CSV or workbook takes seconds of CPU and disk work. Here it runs in a worker
    thread, so the API keeps answering other requests (health checks included) meanwhile.
    """
    path = new_result_file(suffix)
    try:
        await run_in_threadpool(write, path)
    except BaseException:
        remove_file(path)
        raise
    return _download(path, media_type, filename)


def _download(path: str, media_type: str, filename: str) -> FileResponse:
    return FileResponse(path, media_type=media_type, filename=filename, background=delete_after_response(path))
