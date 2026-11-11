import argparse
import json
import logging
import os
import smtplib
import sqlite3
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Optional

from toolbox.job_tracker import stats
from toolbox.job_tracker.classify import excluded_categories

# What this is: the notifier. It tells people when the toolbox is failing
# instead of waiting for someone to open the Reliability page. It implements
# the "Alerting" section of the Reliability backend spec.
#
# Rules this module runs
#   A1  a counted failure opens an incident              sev3   once per incident
#   A2  3+ counted failures on one tool within 60 min    sev2   2 h per tool
#   A3  7-day success rate below target (20+ jobs)       sev2   24 h
#   A4  a job active longer than STUCK_JOB_MINUTES       sev2   1 h per job
#   A7  incident open and unacknowledged for 24 h        reminder  24 h per incident
#   and one short "resolved after <duration>" message when an incident closes.
# A1 and A2 are evaluated when a job finishes (handle_incident_event, called
# from store.py); A3, A4 and A7 by a background thread every 5 minutes
# (start_background_checker, started from the app's lifespan).
#
# NOT here, by design: A5 (canary failure) is raised by the canary script
# itself, which can call send_alert() below; A6 (/ready failing twice in a
# row) needs a probe OUTSIDE the app, because a dead app cannot report that it
# is dead — point an uptime service or the host scheduler at GET /ready.
#
# Settings (environment variables; nothing is hard-coded):
#   ALERT_WEBHOOK_URL         Slack / Teams / Discord incoming-webhook URL
#   ALERT_WEBHOOK_FORMAT      text (default; Slack and legacy Teams connectors)
#                             | teams_workflow (Teams "Workflows" webhooks)
#                             | discord
#   ALERT_EMAIL_TO            comma-separated recipients
#   ALERT_EMAIL_MIN_SEVERITY  lowest severity that is emailed (default sev2);
#                             the webhook gets everything
#   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
#   SMTP_STARTTLS (true)      mail server for the email channel
#   ALERT_COOLDOWN_SCALE      multiplies every cooldown (default 1.0; use 0.01
#                             to test quickly)
#   PUBLIC_BASE_URL           address of the frontend, used for the link
#   ALERT_RUNBOOK_BASE_URL    if set, runbook names become links under it
#   STUCK_JOB_MINUTES         A4 threshold (default 30)
#   STUCK_JOB_MINUTES_OVERRIDES   per-tool thresholds, e.g. "reach=60,h2h=90"
#   ALERT_CHECK_INTERVAL_SECONDS  background check period (default 300)
#   SLO_TARGET                A3 target (default 0.95, shared with /jobs/stats)
#
# Behaviour rules (from the spec): every send first claims a row in
# `alerts_sent`, so one outage cannot send fifty messages (the claim is atomic,
# so several workers cannot double-send either); webhook and email calls use a
# 3-second timeout and run on worker threads; a failed alert is logged and
# swallowed and never reaches a request; alerts carry only the tool name,
# category, exception type and counts — never uploaded data or file contents.
#
# Check it works:  docker compose exec app python -m toolbox.job_tracker.alerts --test

logger = logging.getLogger(__name__)

SEVERITY_RANK = {'sev1': 1, 'sev2': 2, 'sev3': 3, 'reminder': 2}
TIMEOUT_SECONDS = 3
RETENTION_DAYS = 30

H = 3600
COOLDOWNS = {  # seconds; None means "once per key, ever"
    'A1': None,
    'A2': 2 * H,
    'A3': 24 * H,
    'A4': 1 * H,
    'A5': 6 * H,
    'A7': 24 * H,
    'RESOLVED': None,
}

CATEGORY_RUNBOOK = {
    'dependency': 'postgis-unreachable',
    'resource': 'disk-full',
    'interrupted': 'job-stuck',
    'code_error': 'high-failure-rate',
}

# Tests switch this on to run deliveries in the calling thread.
RUN_INLINE = False
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='alert-send')


# ----------------------------------------------------------------- settings
def _env(name: str, default: str = '') -> str:
    return (os.environ.get(name) or default).strip()


def _cooldown_scale() -> float:
    try:
        return max(0.0, float(_env('ALERT_COOLDOWN_SCALE', '1')))
    except ValueError:
        return 1.0


def _email_recipients() -> list[str]:
    return [item.strip() for item in _env('ALERT_EMAIL_TO').split(',') if item.strip()]


def channels_configured() -> dict[str, bool]:
    return {
        'webhook': bool(_env('ALERT_WEBHOOK_URL')),
        'email': bool(_email_recipients() and _env('SMTP_HOST')),
    }


def _stuck_minutes(tool: str) -> float:
    try:
        default = float(_env('STUCK_JOB_MINUTES', '30'))
    except ValueError:
        default = 30.0
    for pair in _env('STUCK_JOB_MINUTES_OVERRIDES').split(','):
        name, _, value = pair.partition('=')
        if name.strip() == tool:
            try:
                return float(value)
            except ValueError:
                pass
    return default


# ---------------------------------------------------------------- messages
def _runbook_line(slug: Optional[str]) -> Optional[str]:
    if not slug:
        return None
    base = _env('ALERT_RUNBOOK_BASE_URL').rstrip('/')
    return f'Runbook: {slug}' + (f' ({base}/{slug}.md)' if base else '')


def _link_line() -> Optional[str]:
    base = _env('PUBLIC_BASE_URL')
    return f'Reliability page (Operations > Reliability): {base}' if base else None


def compose(severity: str, subject: str, details: list[str], runbook: Optional[str] = None) -> tuple[str, str]:
    """(subject line, full text). `details` are short facts: tool, category,
    exception type, counts. Nothing from a user's upload belongs here."""
    head = f'[{severity.upper()}] {subject}'
    lines = [head, *details, *(line for line in (_link_line(), _runbook_line(runbook)) if line)]
    return head, '\n'.join(lines)


def _duration(seconds: Optional[int]) -> str:
    if seconds is None:
        return 'an unknown time'
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days:
        return f'{days} d {hours} h'
    if hours:
        return f'{hours} h {minutes} min'
    if minutes:
        return f'{minutes} min'
    return f'{secs} s'


# ---------------------------------------------------------------- delivery
def _webhook_payload(subject: str, text: str) -> dict[str, Any]:
    fmt = _env('ALERT_WEBHOOK_FORMAT', 'text').lower()
    if fmt == 'discord':
        return {'content': text}
    if fmt == 'teams_workflow':
        return {
            'type': 'message',
            'attachments': [{
                'contentType': 'application/vnd.microsoft.card.adaptive',
                'contentUrl': None,
                'content': {
                    '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
                    'type': 'AdaptiveCard',
                    'version': '1.4',
                    'body': [{'type': 'TextBlock', 'text': line, 'wrap': True, 'weight': 'Bolder' if i == 0 else 'Default'}
                             for i, line in enumerate(text.splitlines())],
                },
            }],
        }
    return {'text': text}


def _send_webhook(subject: str, text: str) -> None:
    request = urllib.request.Request(
        _env('ALERT_WEBHOOK_URL'),
        data=json.dumps(_webhook_payload(subject, text)).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        response.read()


def _send_email(subject: str, text: str) -> None:
    message = EmailMessage()
    message['Subject'] = f'[SDA Toolbox] {subject}'
    message['From'] = _env('SMTP_FROM') or _env('SMTP_USER') or 'sda-toolbox@localhost'
    message['To'] = ', '.join(_email_recipients())
    message.set_content(text)

    host, port = _env('SMTP_HOST'), int(_env('SMTP_PORT', '587') or 587)
    if port == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS)
    else:
        server = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
    with server:
        if port != 465 and _env('SMTP_STARTTLS', 'true').lower() not in ('0', 'false', 'no'):
            server.starttls()
        if _env('SMTP_USER'):
            server.login(_env('SMTP_USER'), _env('SMTP_PASSWORD'))
        server.send_message(message)


def deliver(severity: str, subject: str, text: str) -> dict[str, tuple[bool, str]]:
    """Send to every channel that applies. Returns {channel: (ok, note)}.
    Never raises, and never puts the webhook URL or a password in a note."""
    results: dict[str, tuple[bool, str]] = {}
    configured = channels_configured()

    if configured['webhook']:
        try:
            _send_webhook(subject, text)
            results['webhook'] = (True, 'sent')
        except Exception as exc:  # noqa: BLE001
            results['webhook'] = (False, f'{type(exc).__name__}: {_safe(exc)}')

    if configured['email']:
        min_rank = SEVERITY_RANK.get(_env('ALERT_EMAIL_MIN_SEVERITY', 'sev2').lower(), 2)
        if SEVERITY_RANK.get(severity, 2) <= min_rank:
            try:
                _send_email(subject, text)
                results['email'] = (True, 'sent')
            except Exception as exc:  # noqa: BLE001
                results['email'] = (False, f'{type(exc).__name__}: {_safe(exc)}')
    return results


def _safe(exc: Exception) -> str:
    """Error text with anything URL-like removed (webhook URLs are secrets)."""
    text = str(exc).splitlines()[0] if str(exc) else ''
    return ' '.join(word for word in text.split() if '://' not in word)[:160]


# ------------------------------------------------------ claim / send / record
def _connect():
    from toolbox.job_tracker.store import connect  # imported late: store imports this module
    return connect()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _claim(rule: str, tool: str, key: str, severity: str, subject: str, cooldown: Optional[float]) -> Optional[int]:
    """Atomically check the cooldown and record the send. Returns the row id,
    or None when the same alert was sent inside its cooldown."""
    with _connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        sql = 'SELECT 1 FROM alerts_sent WHERE rule = ? AND tool = ? AND key = ?'
        params: list[Any] = [rule, tool, key]
        if cooldown is not None:
            sql += ' AND sent_at >= ?'
            params.append((_now() - timedelta(seconds=cooldown * _cooldown_scale())).isoformat())
        if conn.execute(sql + ' LIMIT 1', params).fetchone():
            return None
        cursor = conn.execute(
            'INSERT INTO alerts_sent (rule, tool, key, severity, sent_at, channels, summary) '
            "VALUES (?, ?, ?, ?, ?, '', ?)",
            (rule, tool, key, severity, _now().isoformat(), subject[:200]),
        )
        return cursor.lastrowid


def _finish_delivery(claim_id: int, severity: str, subject: str, text: str) -> None:
    try:
        results = deliver(severity, subject, text)
        for channel, (ok, note) in results.items():
            if not ok:
                logger.warning('alert delivery failed: channel=%s %s', channel, note)
        sent = [channel for channel, (ok, _) in results.items() if ok]
        with _connect() as conn:
            if sent:
                conn.execute('UPDATE alerts_sent SET channels = ? WHERE id = ?', (','.join(sent), claim_id))
            else:
                # Nothing got through (or no channel applies to this severity):
                # release the claim so a later evaluation can try again.
                conn.execute('DELETE FROM alerts_sent WHERE id = ?', (claim_id,))
    except Exception:  # noqa: BLE001
        logger.exception('alert delivery crashed')


def send_alert(
    rule: str,
    severity: str,
    tool: str,
    subject: str,
    details: list[str],
    *,
    key: str = '',
    runbook: Optional[str] = None,
    cooldown: Optional[float] = -1,
) -> bool:
    """Queue one alert unless the same (rule, tool, key) was already sent
    inside its cooldown. Returns True when it was queued. Never raises.

    `cooldown` is in seconds before ALERT_COOLDOWN_SCALE; the default (-1)
    uses the rule's entry in COOLDOWNS and None means once per key. This is
    also the entry point for the canary script (rule 'A5')."""
    try:
        if not any(channels_configured().values()):
            return False
        head, text = compose(severity, subject, details, runbook)
        window = COOLDOWNS.get(rule) if cooldown == -1 else cooldown
        claim_id = _claim(rule, tool, key, severity, head, window)
        if claim_id is None:
            return False
        if RUN_INLINE:
            _finish_delivery(claim_id, severity, head, text)
        else:
            _executor.submit(_finish_delivery, claim_id, severity, head, text)
        return True
    except Exception:  # noqa: BLE001
        logger.exception('could not queue alert %s for %s', rule, tool)
        return False


# ------------------------------------------- A1 / A2 / resolved: on job finish
def handle_incident_event(event: dict[str, Any]) -> None:
    """Called by store.finish_job with what the incident bookkeeping did.
    Cheap, and never raises."""
    try:
        kind = event.get('event')
        tool, label = event['tool'], event.get('label') or event['tool']
        category = event.get('error_category') or 'code_error'
        error_type = event.get('error_type') or 'unknown'

        if kind == 'opened':
            send_alert(
                'A1', 'sev3', tool, f'New incident: {label}',
                [f'Tool: {tool}', f'Category: {category} | Type: {error_type}', 'Failures: 1'],
                key=event['incident_id'], runbook=CATEGORY_RUNBOOK.get(category),
            )
        if kind in ('opened', 'extended'):
            _check_repeated_failures(tool, label, category)
        if kind == 'resolved':
            notify_resolved(event['incident_id'])
    except Exception:  # noqa: BLE001
        logger.exception('alert evaluation failed')


def _check_repeated_failures(tool: str, label: str, category: str) -> None:
    excluded = excluded_categories()
    marks = ','.join('?' for _ in excluded) or "''"
    since = (_now() - timedelta(minutes=60)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT error_type FROM jobs WHERE tool = ? AND status = 'failed' AND source = 'user' "
            f"AND ended_at >= ? AND COALESCE(error_category, 'code_error') NOT IN ({marks})",
            (tool, since, *excluded),
        ).fetchall()
    if len(rows) < 3:
        return
    kinds: dict[str, int] = {}
    for (error_type,) in rows:
        kinds[error_type or 'unknown'] = kinds.get(error_type or 'unknown', 0) + 1
    top = max(kinds, key=lambda name: kinds[name])
    send_alert(
        'A2', 'sev2', tool, f'Repeated failures: {label}',
        [f'Tool: {tool}', f'Category: {category} | Most common type: {top}',
         f'Failures: {len(rows)} in the last 60 minutes'],
        runbook=CATEGORY_RUNBOOK.get(category),
    )


def notify_resolved(incident_id: str) -> None:
    """One short message saying an incident ended, so the channel shows the
    outage is over."""
    try:
        from toolbox.job_tracker import incidents
        with _connect() as conn:
            incident = incidents.get_incident(conn, incident_id)
        if not incident or incident['status'] != 'resolved':
            return
        who = incident.get('resolved_by') or 'unknown'
        send_alert(
            'RESOLVED', incident['severity'], incident['tool'], f"Resolved: {incident['title']}",
            [f"Tool: {incident['tool']}", f"Resolved after {_duration(incident.get('duration_seconds'))} "
             f"({'automatically' if who == 'auto' else 'by ' + who})",
             f"Failures during the incident: {incident['failure_count']}"],
            key=incident['id'],
        )
    except Exception:  # noqa: BLE001
        logger.exception('could not send the resolved notice')


# ------------------------------------------------ A3 / A4 / A7: background pass
def run_periodic_checks(now: Optional[datetime] = None) -> list[str]:
    """One pass of the checks that need a clock rather than an event. Returns
    the rules that queued an alert (used by tests)."""
    now = now or _now()
    fired: list[str] = []
    for check in (_check_success_rate, _check_stuck_jobs, _check_unacknowledged):
        try:
            fired.extend(check(now))
        except Exception:  # noqa: BLE001
            logger.exception('alert check %s failed', check.__name__)
    try:
        _prune(now)
    except Exception:  # noqa: BLE001
        logger.exception('could not prune alerts_sent')
    return fired


def _check_success_rate(now: datetime) -> list[str]:
    with _connect() as conn:
        out = stats.compute_stats(conn, window='7d', now=now)
    overall, target = out['overall'], out['target']['success_rate']
    counted_jobs = overall['completed'] + overall['failed_counted']
    if counted_jobs < 20 or overall['success_rate'] is None or overall['success_rate'] >= target:
        return []
    worst = next((t for t in out['by_tool'] if t['failed_counted']), None)
    details = [f"7-day success rate: {overall['success_rate'] * 100:.1f}% (target {target * 100:.0f}%)",
               f"Jobs: {counted_jobs} counted, {overall['failed_counted']} failed"]
    if worst:
        details.append(f"Most failures: {worst['tool']} ({worst['failed_counted']})")
    queued = send_alert('A3', 'sev2', '', 'Success rate below target', details, runbook='high-failure-rate')
    return ['A3'] if queued else []


def _check_stuck_jobs(now: datetime) -> list[str]:
    fired = []
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        active = conn.execute(
            "SELECT id, tool, label, started_at, stage FROM jobs WHERE status = 'active'").fetchall()
    for job in active:
        try:
            minutes = (now - datetime.fromisoformat(job['started_at'])).total_seconds() / 60
        except ValueError:
            continue
        limit = _stuck_minutes(job['tool'])
        if minutes <= limit:
            continue
        details = [f"Tool: {job['tool']}", f'Running for {_duration(int(minutes * 60))} (limit {limit:g} min)']
        if job['stage']:
            details.append(f"Last reported stage: {job['stage']}")
        if send_alert('A4', 'sev2', job['tool'], f"Job may be stuck: {job['label']}", details,
                      key=job['id'], runbook='job-stuck'):
            fired.append('A4')
    return fired


def _check_unacknowledged(now: datetime) -> list[str]:
    fired = []
    cutoff = (now - timedelta(hours=24)).isoformat()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        stale = conn.execute(
            "SELECT id, tool, title, opened_at, failure_count, error_category FROM incidents "
            "WHERE status = 'open' AND opened_at <= ?", (cutoff,)).fetchall()
    for incident in stale:
        age = int((now - datetime.fromisoformat(incident['opened_at'])).total_seconds())
        if send_alert('A7', 'reminder', incident['tool'], f"Still open: {incident['title']}",
                      [f"Tool: {incident['tool']}", f'Open for {_duration(age)} and not acknowledged',
                       f"Failures so far: {incident['failure_count']}"],
                      key=incident['id'], runbook=CATEGORY_RUNBOOK.get(incident['error_category'] or '')):
            fired.append('A7')
    return fired


def _prune(now: datetime) -> None:
    cutoff = (now - timedelta(days=RETENTION_DAYS)).isoformat()
    with _connect() as conn:
        conn.execute('DELETE FROM alerts_sent WHERE sent_at < ?', (cutoff,))


# ------------------------------------------------------- background thread
class BackgroundChecker:
    """Daemon thread that runs run_periodic_checks() on a timer. A thread
    rather than an asyncio task because the work is SQLite queries and HTTP
    posts, which would block the event loop."""

    def __init__(self, interval: float, first_delay: float = 30.0):
        self._stop = threading.Event()
        self._interval, self._first_delay = interval, first_delay
        self._thread = threading.Thread(target=self._run, name='alert-checker', daemon=True)

    def start(self) -> 'BackgroundChecker':
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Wait before the first pass so a restart does not fire instantly.
        if self._stop.wait(self._first_delay):
            return
        while True:
            run_periodic_checks()
            if self._stop.wait(self._interval):
                return


def start_background_checker() -> Optional[BackgroundChecker]:
    try:
        interval = max(10.0, float(_env('ALERT_CHECK_INTERVAL_SECONDS', '300')))
    except ValueError:
        interval = 300.0
    if not any(channels_configured().values()):
        logger.info('alerts: no ALERT_WEBHOOK_URL / ALERT_EMAIL_TO configured; notifier is idle')
    return BackgroundChecker(interval).start()


@asynccontextmanager
async def lifespan(_app):
    """FastAPI lifespan: start the checker with the app, stop it on shutdown."""
    checker = start_background_checker()
    try:
        yield
    finally:
        if checker:
            checker.stop()


# --------------------------------------------------------------------- CLI
def _cli() -> int:
    parser = argparse.ArgumentParser(description='SDA Toolbox notifier')
    parser.add_argument('--test', action='store_true', help='send a test message to every configured channel')
    args = parser.parse_args()
    configured = channels_configured()
    print(f"webhook configured: {configured['webhook']} (format: {_env('ALERT_WEBHOOK_FORMAT', 'text')})")
    print(f"email configured:   {configured['email']} "
          f"(recipients: {len(_email_recipients())}, SMTP host set: {bool(_env('SMTP_HOST'))}, "
          f"min severity: {_env('ALERT_EMAIL_MIN_SEVERITY', 'sev2')})")
    if not args.test:
        return 0
    if not any(configured.values()):
        print('Nothing to test: set ALERT_WEBHOOK_URL, or ALERT_EMAIL_TO together with SMTP_HOST.')
        return 1
    head, text = compose('sev2', 'Test alert from SDA Toolbox',
                         ['This is a test. No action is needed.', 'Tool: none'])
    results = deliver('sev2', head, text)
    for channel, (ok, note) in results.items():
        print(f"{channel}: {'OK' if ok else 'FAILED'} - {note}")
    if not results:
        print('No channel accepted a sev2 message (check ALERT_EMAIL_MIN_SEVERITY).')
    return 0 if results and all(ok for ok, _ in results.values()) else 1


if __name__ == '__main__':
    raise SystemExit(_cli())
