"""Run heavy synchronous work off the event loop, a few jobs at a time.

The analysis tools do minutes of pandas/geopandas work. In an `async def` route that work
runs on the event loop, so every other request, /health and /ready included, waits until it
finishes (hardening item H7). `run_heavy` hands the work to a worker thread instead, so the
API keeps answering.

It also limits how many heavy jobs run at once (HEAVY_JOB_LIMIT, default 2): before, they
ran one after another because each froze the server, and starting several together would
multiply their memory use. A job over the limit waits its turn.

    result = await run_heavy(triangulating_reached_settlements, gdf, datasets, methods)

The worker thread inherits the request's context variables, so the job id used for job
logs and stage reports still works inside it.
"""
import asyncio
import logging
import os
import weakref
from typing import Any, Callable, TypeVar

from starlette.concurrency import run_in_threadpool

DEFAULT_LIMIT = 2
T = TypeVar('T')

# One semaphore per event loop: a semaphore must not be shared between loops.
_semaphores: 'weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]' = weakref.WeakKeyDictionary()


def heavy_job_limit() -> int:
    try:
        return max(1, int(os.environ.get('HEAVY_JOB_LIMIT', DEFAULT_LIMIT)))
    except ValueError:
        return DEFAULT_LIMIT


def _semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    semaphore = _semaphores.get(loop)
    if semaphore is None:
        semaphore = _semaphores[loop] = asyncio.Semaphore(heavy_job_limit())
    return semaphore


async def run_heavy(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Call `func(*args, **kwargs)` in a worker thread, waiting first if HEAVY_JOB_LIMIT heavy jobs are already running."""
    semaphore = _semaphore()
    if semaphore.locked():
        logging.info('Other analyses are already running; this one starts when one of them finishes.')
    async with semaphore:
        return await run_in_threadpool(func, *args, **kwargs)
