import logging
from contextvars import ContextVar
from typing import Optional

# What this is: lets code deep inside a tool know which job it is running
# for, without every function having to pass a job id around.
#
# JobLoggingMiddleware sets `current_job_id` for the duration of a tracked
# request. Because contextvars are copied into the worker threads FastAPI
# runs sync endpoints in, the value is visible there too. Two things use it:
#
#   * JobIdFilter puts "[job=<first 8 chars of the id>]" in front of every
#     log line written while a job is running, so a failed job's log lines
#     can be found with one search (the Reliability page shows the same
#     8-character id).
#   * report_stage() lets a long tool record where it is ("reading tracks",
#     "writing workbook"), saved on the job row. If the job later stalls or
#     crashes, the row says how far it got.

current_job_id: ContextVar[Optional[str]] = ContextVar('current_job_id', default=None)

# The id the browser chose for this run (X-Client-Job-Id header), used to copy
# log lines into the live log the page polls (joblog.py). Set only when the
# header was a valid, unused UUID; None for every other request.
current_client_job_id: ContextVar[Optional[str]] = ContextVar('current_client_job_id', default=None)


class JobIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        job_id = current_job_id.get()
        if job_id and not getattr(record, '_job_stamped', False):
            try:
                record.msg = f'[job={job_id[:8]}] {record.getMessage()}'
                record.args = ()
                record._job_stamped = True
            except Exception:
                # Never let a malformed log call break logging because of us.
                pass
        return True


def install_log_filter() -> None:
    """Attach JobIdFilter to the root logger's handlers (idempotent).

    Handlers are the right place for it: a filter on a logger only sees
    records logged directly to that logger, while one on a handler sees
    everything that reaches the log file. The handler only exists once
    toolbox/utils/logger.py has run, so the middleware calls this at start-up
    and again per tracked request, which costs a short loop.
    """
    for handler in logging.getLogger().handlers:
        if not any(isinstance(existing, JobIdFilter) for existing in handler.filters):
            handler.addFilter(JobIdFilter())


def report_stage(stage: str) -> None:
    """Record what the current job is doing right now. Safe to call anywhere:
    outside a tracked request, or if the job store is unavailable, it does
    nothing."""
    job_id = current_job_id.get()
    if not job_id:
        return
    try:
        from toolbox.job_tracker.store import set_stage
        set_stage(job_id, stage)
    except Exception:
        logging.getLogger(__name__).debug('report_stage failed', exc_info=True)
