# Thin re-export so `from .db_access import uuid_checker, jobs` and
# `app.include_router(jobs.router)` in sda_toolbox.py resolve under the
# apps/-style import convention (grouped under "DB Access" alongside
# uuid_checker, since jobs.py didn't exist on disk here yet when this was
# added). The real implementation — the SQLite job store, the
# JobLoggingMiddleware that writes to it, and this router's actual routes —
# lives in toolbox/job_tracker/ (see that package). This file intentionally
# has no logic of its own.
from toolbox.job_tracker.router import router

__all__ = ['router']
