#!/usr/bin/env python3
"""Daily canary for the SDA Toolbox.

Posts a small known-good request to the running backend and checks the answer,
so a broken tool or platform fault is found before a user finds it. It
implements the "Daily canary" part of the Reliability backend spec and raises
alert A5 when something fails.

    python scripts/canary.py                 run every enabled check (what the scheduler runs)
    python scripts/canary.py --list          show the checks and whether they are enabled
    python scripts/canary.py --tool reach    run ONE check verbosely, even if disabled; no alert,
                                             no state change (use it to calibrate a new fixture)
    python scripts/canary.py --no-alert      run everything but do not post to Slack

Exit code: 0 all checks passed, 1 at least one failed, 2 the canary itself is
misconfigured (e.g. no CANARY_TOKEN).

What it checks is described in tests/fixtures/canary/manifest.json:
  * "platform" checks need no input files: /health, /ready, and one database
    lookup through /uuid_check.
  * "tool" checks post fixture files from tests/fixtures/canary/<tool>/ and
    assert on the output. They ship DISABLED until a fixture exists and
    `--tool <name>` passes; then set "enabled": true in the manifest.
A check that cannot run (fixture missing, script error) counts as FAILED, never
as a pass. If the backend itself is unreachable only that one failure is
reported and the remaining checks are skipped, so an outage sends one alert.

Every request carries `X-Canary: <CANARY_TOKEN>`, so the backend records the job
with source = 'canary': it does not distort the user success rate, but it does
count towards closing incidents. Put the same CANARY_TOKEN in the repo's .env
(the container reads it from there) and this script reads it from the same
file. Other settings, all optional: CANARY_BASE_URL (default
http://localhost:8000), ALERT_WEBHOOK_URL / ALERT_WEBHOOK_FORMAT / PUBLIC_BASE_URL
(same meaning as for the backend's own alerts), CANARY_ALERT_COOLDOWN_HOURS (6).

Only the standard library is used, so any Python 3.10+ can run it.
"""
import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = ROOT / 'tests' / 'fixtures' / 'canary'
MANIFEST = FIXTURE_DIR / 'manifest.json'
STATE_DIR = ROOT / 'logs' / 'canary'
DEFAULT_TIMEOUT = 90
ALERT_TIMEOUT = 5


# ------------------------------------------------------------------ settings
def load_env_file(path: Path) -> None:
    """Read KEY=VALUE lines from the repo's .env without overriding variables
    that are already set. Values are never printed."""
    if not path.is_file():
        return
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(key.strip().removeprefix('export ').strip(), value)


# -------------------------------------------------------------------- http
class Unreachable(Exception):
    pass


@dataclass
class Reply:
    status: int
    headers: dict[str, str]
    body: bytes
    ms: int

    def text(self) -> str:
        return self.body.decode('utf-8', errors='replace')

    def json(self) -> Any:
        return json.loads(self.body)


def encode_multipart(fields: dict[str, str], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = f'----canary{uuid.uuid4().hex}'
    out = io.BytesIO()

    def part(disposition: str, content: bytes, content_type: Optional[str] = None) -> None:
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; {disposition}\r\n'.encode())
        if content_type:
            out.write(f'Content-Type: {content_type}\r\n'.encode())
        out.write(b'\r\n' + content + b'\r\n')

    for name, value in fields.items():
        part(f'name="{name}"', str(value).encode('utf-8'))
    for name, path in files.items():
        part(f'name="{name}"; filename="{path.name}"', path.read_bytes(), 'application/octet-stream')
    out.write(f'--{boundary}--\r\n'.encode())
    return out.getvalue(), f'multipart/form-data; boundary={boundary}'


def call(method: str, url: str, headers: dict[str, str], body: Optional[bytes], timeout: float) -> Reply:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    began = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, resp_headers, data = response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:  # 4xx / 5xx still carry a reply
        status, resp_headers, data = error.code, error.headers, error.read()
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
        reason = getattr(error, 'reason', error)
        raise Unreachable(f'{type(reason).__name__}: {reason}') from None
    return Reply(status, {k.lower(): v for k, v in resp_headers.items()}, data, int((time.monotonic() - began) * 1000))


# ----------------------------------------------------------------- checking
@dataclass
class Result:
    name: str
    ok: bool
    reason: str = ''
    status: Optional[int] = None
    ms: int = 0
    skipped: bool = False
    note: str = ''
    unreachable: bool = False


def evaluate(reply: Reply, expect: dict[str, Any]) -> list[str]:
    """Return what is wrong with `reply` (empty list = fine)."""
    problems: list[str] = []
    wanted = expect.get('status', 200)
    if reply.status != wanted:
        hint = ' (the fixture may be out of date)' if reply.status in (400, 404, 405, 413, 415, 422) else ''
        return [f'expected HTTP {wanted}, got {reply.status}{hint}']

    if 'content_type' in expect and expect['content_type'] not in reply.headers.get('content-type', ''):
        problems.append(f"content type {reply.headers.get('content-type', 'none')!r} is not {expect['content_type']!r}")
    for header in expect.get('headers_present', []):
        if header.lower() not in reply.headers:
            problems.append(f'response header {header} is missing')

    if 'json_has' in expect or 'json_equals' in expect:
        try:
            data = reply.json()
        except ValueError:
            return problems + ['response is not JSON']
        for key in expect.get('json_has', []):
            if not isinstance(data, dict) or key not in data:
                problems.append(f'JSON field {key!r} is missing')
        for key, value in expect.get('json_equals', {}).items():
            if not isinstance(data, dict) or data.get(key) != value:
                problems.append(f'JSON field {key!r} is not {value!r}')

    if 'csv_columns' in expect or 'min_rows' in expect:
        rows = list(csv.reader(io.StringIO(reply.text())))
        header = [h.strip().lower() for h in (rows[0] if rows else [])]
        missing = [c for c in expect.get('csv_columns', []) if c.lower() not in header]
        if missing:
            problems.append(f"missing CSV columns: {', '.join(missing)}")
        if max(len(rows) - 1, 0) < expect.get('min_rows', 0):
            problems.append(f'CSV has {max(len(rows) - 1, 0)} rows, expected at least {expect["min_rows"]}')

    if 'zip_contains' in expect:
        try:
            names = zipfile.ZipFile(io.BytesIO(reply.body)).namelist()
        except zipfile.BadZipFile:
            return problems + ['response is not a readable zip']
        for suffix in expect['zip_contains']:
            if not any(n.lower().endswith(suffix.lower()) for n in names):
                problems.append(f'zip has no {suffix} file')

    if expect.get('ready'):
        try:
            report = reply.json()
        except ValueError:
            return problems + ['/ready did not return JSON']
        broken = [c['name'] for c in report.get('checks', []) if c.get('critical') and not c.get('ok')]
        if report.get('status') == 'not_ready' or broken:
            problems.append(f"not ready: {', '.join(broken) or report.get('status')}")
    return problems


def run_check(base: str, token: str, check: dict[str, Any]) -> Result:
    name = check['name']
    timeout = check.get('timeout', DEFAULT_TIMEOUT)
    headers = {'X-Canary': token}
    try:
        method = check.get('method', 'GET').upper()
        url = base.rstrip('/') + check['path']
        if check.get('query'):
            url += ('&' if '?' in url else '?') + urllib.parse.urlencode(check['query'])
        unset = [k for k, v in {**check.get('query', {}), **check.get('form', {})}.items() if v == 'REPLACE_ME']
        if unset:
            return Result(name, False, f"manifest value not set: {', '.join(unset)} (edit tests/fixtures/canary/manifest.json)")
        body = None
        if check.get('files') or check.get('form'):
            files = {}
            for field_name, rel in check.get('files', {}).items():
                path = FIXTURE_DIR / rel
                if not path.is_file():
                    return Result(name, False, f'fixture file missing: tests/fixtures/canary/{rel}')
                files[field_name] = path
            body, headers['Content-Type'] = encode_multipart(check.get('form', {}), files)

        reply = call(method, url, headers, body, timeout)
        problems = evaluate(reply, check.get('expect', {}))
        total_ms = reply.ms

        follow = check.get('followup')
        if follow and not problems:
            path = follow['path']
            for header, value in reply.headers.items():
                path = path.replace('{header:' + header + '}', value)
            if '{header:' in path:
                problems.append('response did not carry the id the follow-up request needs')
            else:
                second = call(follow.get('method', 'GET').upper(), base.rstrip('/') + path, headers, None, timeout)
                total_ms += second.ms
                problems += [f'follow-up: {p}' for p in evaluate(second, follow.get('expect', {}))]

        note = ''
        if check.get('expect', {}).get('ready') and reply.status == 200:
            try:
                bad = [c['name'] for c in reply.json().get('checks', []) if not c.get('ok')]
                note = f"degraded: {', '.join(bad)}" if bad else ''
            except ValueError:
                pass
        return Result(name, not problems, '; '.join(problems), reply.status, total_ms, note=note)
    except Unreachable as error:
        return Result(name, False, f'backend not reachable ({error})', unreachable=True)
    except Exception as error:  # noqa: BLE001 - a canary bug must show up as a failure
        return Result(name, False, f'canary error: {type(error).__name__}: {error}')


# ------------------------------------------------------------------- alerts
def webhook_payload(text: str) -> dict[str, Any]:
    fmt = os.environ.get('ALERT_WEBHOOK_FORMAT', 'text').strip().lower()
    if fmt == 'discord':
        return {'content': text}
    if fmt == 'teams_workflow':
        return {'type': 'message', 'attachments': [{
            'contentType': 'application/vnd.microsoft.card.adaptive', 'contentUrl': None,
            'content': {'$schema': 'http://adaptivecards.io/schemas/adaptive-card.json', 'type': 'AdaptiveCard',
                        'version': '1.4',
                        'body': [{'type': 'TextBlock', 'text': line, 'wrap': True} for line in text.splitlines()]}}]}
    return {'text': text}


def post_alert(text: str) -> bool:
    url = os.environ.get('ALERT_WEBHOOK_URL', '').strip()
    if not url:
        return False
    request = urllib.request.Request(url, data=json.dumps(webhook_payload(text)).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=ALERT_TIMEOUT) as response:
            response.read()
        return True
    except Exception as error:  # noqa: BLE001 - never print the URL, it is a secret
        print(f'  could not post the alert: {type(error).__name__}', file=sys.stderr)
        return False


def load_state() -> dict[str, Any]:
    try:
        return json.loads((STATE_DIR / 'state.json').read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / 'state.json').write_text(json.dumps(state, indent=2))


def decide_alerts(results: list[Result], state: dict[str, Any], now: datetime) -> tuple[list[tuple[Result, int]], str]:
    """Update failure counters in `state` and return (failures worth telling
    people about, severity). Rule A5: sev2 on a first failure, sev1 on a
    second consecutive failure of the same check, at most once per cooldown
    per check — except that moving to sev1 is always announced."""
    cooldown = timedelta(hours=float(os.environ.get('CANARY_ALERT_COOLDOWN_HOURS', '6') or 6))
    to_report: list[tuple[Result, int]] = []
    for result in results:
        if result.skipped:
            continue
        entry = state.setdefault(result.name, {'consecutive': 0, 'last_alert_at': None})
        if result.ok:
            entry['consecutive'] = 0
            continue
        entry['consecutive'] += 1
        last = entry['last_alert_at']
        cooled = last is None or now - datetime.fromisoformat(last) >= cooldown
        if cooled or entry['consecutive'] == 2:
            to_report.append((result, entry['consecutive']))
            entry['last_alert_at'] = now.isoformat()
    severity = 'sev1' if any(count >= 2 for _, count in to_report) else 'sev2'
    return to_report, severity


def alert_text(to_report: list[tuple[Result, int]], severity: str, now: datetime, seconds: float) -> str:
    names = ', '.join(r.name for r, _ in to_report)
    lines = [f'[{severity.upper()}] Canary failed: {names}']
    for result, count in to_report:
        where = f'HTTP {result.status}' if result.status else 'no response'
        lines.append(f'{result.name}: {where}. {result.reason}')
        lines.append(f'  Consecutive failed runs: {count}')
    lines.append(f'Run: {now:%Y-%m-%d %H:%M} UTC, took {seconds:.1f} s')
    if os.environ.get('PUBLIC_BASE_URL'):
        lines.append(f"Reliability page (Operations > Reliability): {os.environ['PUBLIC_BASE_URL'].strip()}")
    lines.append('Runbook: canary-failed')
    return '\n'.join(lines)


# --------------------------------------------------------------------- main
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description='SDA Toolbox daily canary')
    parser.add_argument('--base-url', help='backend address (default CANARY_BASE_URL or http://localhost:8000)')
    parser.add_argument('--tool', help='run only this check, verbosely, even if disabled (no alert, no state)')
    parser.add_argument('--list', action='store_true', help='list the checks and exit')
    parser.add_argument('--no-alert', action='store_true', help='do not post to the webhook')
    parser.add_argument('--manifest', default=str(MANIFEST), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    load_env_file(ROOT / '.env')
    try:
        checks = json.loads(Path(args.manifest).read_text(encoding='utf-8'))['checks']
    except (OSError, ValueError, KeyError) as error:
        print(f'Cannot read the canary manifest: {error}', file=sys.stderr)
        return 2

    if args.list:
        for check in checks:
            state = 'enabled ' if check.get('enabled', True) else 'DISABLED'
            print(f"{state}  {check['name']:<26} {check.get('method', 'GET'):<5} {check['path']}")
        return 0

    token = os.environ.get('CANARY_TOKEN', '').strip()
    if not token:
        print('CANARY_TOKEN is not set. Add a long random value to .env (the backend reads the same file) so '
              'canary runs are recorded separately from user jobs.', file=sys.stderr)
        return 2

    single = args.tool
    if single:
        selected = [c for c in checks if c['name'] == single]
        if not selected:
            print(f"No check named {single!r}. Try --list.", file=sys.stderr)
            return 2
    else:
        selected = checks

    base = args.base_url or os.environ.get('CANARY_BASE_URL', 'http://localhost:8000')
    began, now = time.monotonic(), datetime.now(timezone.utc)
    results: list[Result] = []
    down = False
    for check in selected:
        if not single and not check.get('enabled', True):
            results.append(Result(check['name'], True, skipped=True, note='disabled'))
        elif down:
            results.append(Result(check['name'], True, skipped=True, note='skipped: backend unreachable'))
        else:
            result = run_check(base, token, check)
            down = result.unreachable
            results.append(result)

    width = max(len(r.name) for r in results)
    for r in results:
        label = 'SKIP' if r.skipped else ('PASS' if r.ok else 'FAIL')
        detail = r.reason or r.note
        print(f"{label}  {r.name:<{width}}  {r.ms:>6} ms  {detail}".rstrip())
    elapsed = time.monotonic() - began
    failed = [r for r in results if not r.ok and not r.skipped]
    print(f"{len([r for r in results if not r.skipped]) - len(failed)} passed, {len(failed)} failed, "
          f"{len([r for r in results if r.skipped])} skipped in {elapsed:.1f} s")

    if not single:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with (STATE_DIR / 'runs.jsonl').open('a', encoding='utf-8') as log:
            log.write(json.dumps({'at': now.isoformat(), 'seconds': round(elapsed, 1), 'results': [
                {'name': r.name, 'ok': r.ok, 'skipped': r.skipped, 'reason': r.reason, 'status': r.status}
                for r in results]}) + '\n')
        state = load_state()
        to_report, severity = decide_alerts(results, state, now)
        save_state(state)
        if to_report and not args.no_alert:
            sent = post_alert(alert_text(to_report, severity, now, elapsed))
            print('alert posted' if sent else 'alert NOT posted (no webhook configured, or it failed)')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
