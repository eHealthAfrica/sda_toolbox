import logging
import os
import re
import shutil
import tempfile
import time
from typing import Callable

from toolbox.job_tracker import store

# What this is: the two probes behind GET /health and GET /ready.
#
#   /health  answers "is the process alive and able to run Python?". It does
#            no work on purpose: a container orchestrator or uptime monitor
#            can call it every few seconds, and if it ever fails to answer
#            the process is hung, which is exactly what it should detect.
#   /ready   answers "can this instance do useful work right now?". It runs
#            the checks below. A failing CRITICAL check means the instance
#            cannot serve tools (HTTP 503, status 'not_ready'); a failing
#            non-critical check is a warning (HTTP 200, status 'degraded').
#
# Check results never contain passwords or connection strings.

_STARTED = time.monotonic()
_TOOLBOX_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGS_DIR = os.path.join(_TOOLBOX_DIR, 'logs')

logger = logging.getLogger(__name__)


def liveness() -> dict:
    return {'status': 'ok'}


def _min_free_gb() -> float:
    try:
        return float(os.environ.get('MIN_FREE_DISK_GB', 2))
    except ValueError:
        return 2.0


def _scrub(message: str) -> str:
    """First line of an error message, trimmed, with any 'password=...' removed."""
    first = (message or '').strip().splitlines()[0] if (message or '').strip() else ''
    first = re.sub(r'(?i)(password\s*[=:]\s*)\S+', r'\1***', first)
    return first[:160]


def _check_jobs_db() -> tuple[bool, str]:
    with store.connect() as conn:
        conn.execute('SELECT 1 FROM jobs LIMIT 1').fetchall()
    return True, 'job history database readable'


def _check_logs_dir() -> tuple[bool, str]:
    os.makedirs(_LOGS_DIR, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=_LOGS_DIR, prefix='.ready-', delete=True) as handle:
        handle.write(b'ok')
    return True, 'logs folder writable'


def _check_disk_free() -> tuple[bool, str]:
    os.makedirs(_LOGS_DIR, exist_ok=True)
    free_gb = shutil.disk_usage(_LOGS_DIR).free / (1024 ** 3)
    minimum = _min_free_gb()
    return free_gb >= minimum, f'{free_gb:.1f} GB free (minimum {minimum:g} GB)'


def _check_postgis() -> tuple[bool, str]:
    # Imported here so /ready still answers on an instance whose database
    # settings are missing, and so a slow import never delays /health.
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool
    from toolbox.utils import Credential

    engine = create_engine(
        Credential().connection_string, poolclass=NullPool, connect_args={'connect_timeout': 3}
    )
    try:
        with engine.connect() as connection:
            version = connection.execute(text('SELECT PostGIS_Version()')).scalar()
    finally:
        engine.dispose()
    return True, f'PostGIS {str(version).split()[0]} reachable'


def _check_reference_data() -> tuple[bool, str]:
    from toolbox.configs import CONFIG

    datasets = CONFIG.get('DATASETS') or {}
    if not datasets.get('settlements'):
        return False, 'config.yaml has no settlements dataset configured'
    return True, f'config loaded; {len(datasets)} datasets configured'


# (name, critical, function)
_CHECKS: list[tuple[str, bool, Callable[[], tuple[bool, str]]]] = [
    ('jobs_db', True, _check_jobs_db),
    ('logs_dir_writable', True, _check_logs_dir),
    ('disk_free', True, _check_disk_free),
    ('postgis', False, _check_postgis),
    ('reference_data', False, _check_reference_data),
]


def _run(name: str, critical: bool, check: Callable[[], tuple[bool, str]]) -> dict:
    started = time.perf_counter()
    try:
        ok, detail = check()
    except Exception as exc:
        ok, detail = False, _scrub(f'{type(exc).__name__}: {exc}')
    return {
        'name': name,
        'ok': bool(ok),
        'critical': critical,
        'ms': int((time.perf_counter() - started) * 1000),
        'detail': detail,
    }


def readiness() -> tuple[dict, int]:
    """Run every check. Returns (report, http_status)."""
    checks = [_run(name, critical, check) for name, critical, check in _CHECKS]
    if any(c['critical'] and not c['ok'] for c in checks):
        status, code = 'not_ready', 503
    elif any(not c['ok'] for c in checks):
        status, code = 'degraded', 200
    else:
        status, code = 'ready', 200
    report = {
        'status': status,
        'uptime_seconds': int(time.monotonic() - _STARTED),
        'checks': checks,
    }
    return report, code
