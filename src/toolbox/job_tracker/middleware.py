import hmac
import json
import logging
import os
import re
from typing import Optional

from starlette.types import ASGIApp, Receive, Scope, Send

from toolbox.job_tracker import joblog
from toolbox.job_tracker.store import start_job, finish_job
from toolbox.job_tracker.classify import CATEGORY_HEADER, classify, describe_exception, traceback_hash
from toolbox.job_tracker.context import current_job_id, current_client_job_id, install_log_filter

# Set by a tool that finished but found something wrong with the data
# (toolbox/dataops/checks.py). Kept here as a literal so the job tracker does not
# import the tools' package.
WARNING_HEADER = 'X-Data-Warning'

logger = logging.getLogger(__name__)

# How much of an error response's body is kept as the job's `error_detail`.
# Only responses with status >= 400 are looked at, and only a copy of the
# first bytes is taken — every message is still forwarded to the client
# unchanged, so this never buffers or alters a (possibly very large) success
# or streaming response.
MAX_ERROR_BODY_BYTES = 2048
CANARY_HEADER = b'x-canary'
# The id the browser chose for this run, so it can poll the live log (joblog.py).
CLIENT_JOB_ID_HEADER = b'x-client-job-id'

# Every real tool endpoint in this app, mapped to the same (tool, label)
# shape the frontend's own session tracker uses (see
# src/frontend/src/state/jobTracker.tsx's AppView keys) so a Dashboard built
# against this data reads the same way the old client-only counts did.
# Deliberately a whitelist keyed on (method, path): anything not listed here
# — /docs, /openapi.json, CORS preflights, a future health-check route, etc.
# — is never logged as a job. Built by grepping every `@router.<verb>(...)`
# path actually declared under toolbox/apps/ (see each router file for the
# exact route) — including a few whose page doesn't exist in the frontend
# yet (contact_analysis, submission_reviewer, checkout, reports/post,
# reports/timespent) and one whose router isn't even mounted right now
# (tracking/buffer — hitnrun_validation.router's include_router call is
# commented out in sda_toolbox.py); those are listed anyway so logging picks
# them up automatically the moment either gets wired in, with no changes
# needed here.
TOOL_ENDPOINTS: dict[tuple[str, str], tuple[str, str]] = {
    ('GET', '/uuid_check'): ('uuid-checker', 'UUID Checker — single lookup'),
    ('POST', '/uuid_batch_checker'): ('uuid-checker', 'UUID Checker — batch'),
    ('POST', '/aggregator/dmp/combine'): ('microplan-combine', 'Microplan — Combine DMP Files'),
    ('POST', '/microplan'): ('microplan-dip', 'Microplan — DIP (legacy)'),
    ('POST', '/dip/merger'): ('microplan-merger', 'Microplan — DIP + Map Merger'),
    ('POST', '/dip/validator'): ('microplan-validate', 'Microplan — Validate DIP'),
    ('POST', '/dip/generator'): ('microplan-generator', 'Microplan — DIP Generator'),
    ('POST', '/compiler/disaggregate'): ('compiler-disaggregate', 'Compiler — Disaggregate MLoS'),
    ('POST', '/checkout'): ('checkout', 'Planfeld — Checkout Update'),
    ('POST', '/compiler/tracks'): ('compiler-tracks', 'Compiler — Tracks'),
    ('POST', '/compiler/lga_data'): ('compiler-lga-data', 'Compiler — Combine LGA Data'),
    ('POST', '/qc/standardize'): ('mlos-ops', 'MLoS — Standardize'),
    ('POST', '/contact_analysis'): ('contact-analysis', 'Campaign — Contact Analysis'),
    ('POST', '/submission_reviewer'): ('submission-reviewer', 'Campaign — Submission Reviewer'),
    ('POST', '/qc/validation'): ('mlos-qc', 'MLoS — QC & Validation'),
    ('POST', '/ta/generate_ta'): ('target-area', 'Target Area Generator'),
    ('PATCH', '/qc/fixer'): ('mlos-ops', 'MLoS — Fixer'),
    ('PATCH', '/mlos/validation'): ('mlos-ops', 'MLoS — Update Validation'),
    ('POST', '/tracking/buffer'): ('hitnrun', 'Tracking — Buffer/Hit & Run Validation'),
    ('POST', '/tracking/gridded'): ('h2h', 'Tracking — Gridded H2H'),
    ('POST', '/validation'): ('reach', 'Tracking — REACH Analysis'),
    ('POST', '/reports/daily'): ('daily-report', 'Reporting — Daily Report'),
    ('POST', '/reports/post'): ('post-implementation-report', 'Reporting — Post Implementation Report'),
    ('POST', '/reports/timespent'): ('timespent', 'Reporting — Timespent Analysis'),
    ('POST', '/coordinate_review'): ('settlements-coordinate-review', 'Settlement Coordinate Triangulation and Review'),
    ('POST', '/duplicate-deep-search'): ('search-for-duplicate-settlements', 'Duplicate Settlements Review'),
    ('POST', '/ta/generate_ta/buffer'): ('generate_buffer_based_ta', 'Generate Buffer-based Target Area'),
    ('POST', "/tracking/devices"): ('gts_device_tracking', 'GTS Team and Device Tracking'),
    ('POST', '/campaign/checkout'): ('update_checkout', 'Upload Checkout Data')
}


class JobLoggingMiddleware:
    """Automatically records a job row for every request that hits a known
    tool endpoint — no page has to opt in.

    Deliberately implemented as a plain ASGI middleware (the `__call__(scope,
    receive, send)` shape below), NOT `starlette.middleware.base
    .BaseHTTPMiddleware` — that was this class's original implementation,
    and it's the wrong tool for a middleware that wraps a
    `StreamingResponse`. `BaseHTTPMiddleware.dispatch()` has to fully
    intercept the wrapped app's response — including a StreamingResponse's
    body — through an internal buffered relay (`call_next()`'s
    memory-object-stream) before Starlette re-sends it to the client; this
    is Starlette's own long-documented footgun with StreamingResponse
    (see e.g. encode/starlette#1012) and was the real cause of the
    "Bug: uncompressed data size mismatch" JSZip error the H2H Settlement
    Tracking page was hitting on the frontend — `/tracking/gridded` (see
    h2h_validation.py) returns exactly this shape: a `StreamingResponse`
    over a `BytesIO` zip that can be tens of MB once GPS tracks are
    included, precisely the case where that relay has been known to
    corrupt or short a large body in transit. Fixing the zip-writing
    inconsistency in toolbox/tools/helper.py (allowZip64) turned out not to
    be the whole story — this middleware, added afterward for the
    Dashboard's job log, was re-corrupting the same response downstream of
    a now-correctly-written zip.

    A plain ASGI middleware sidesteps this entirely: it wraps `send`
    directly and passes every `http.response.body` message through
    untouched — no buffering, no re-streaming, no second pass over the
    body — and only inspects the single `http.response.start` message to
    learn the status code for logging.

    Reliability upgrade: for a response with status >= 400 the wrapper also
    keeps a COPY of the first 2 KB of the body (and the X-Error-Category
    header) so the failure can be filed with a reason; the copy is taken
    while the very same messages are forwarded, so the client still receives
    the response untouched. Successful and streaming responses are never
    copied. Everything the middleware records is wrapped so that a problem in
    the bookkeeping can never change what the user's request returns.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        match = TOOL_ENDPOINTS.get((scope['method'], scope['path']))
        if match is None:
            await self.app(scope, receive, send)
            return

        tool, label = match
        install_log_filter()
        joblog.install_log_handler()
        client = scope.get('client')
        client_host = client[0] if client else None
        request_headers = dict(scope.get('headers') or [])
        client_job_id = _client_job_id(request_headers)

        try:
            job_id = start_job(
                tool=tool,
                label=label,
                method=scope['method'],
                path=scope['path'],
                client_host=client_host,
                source=_source_of(request_headers),
                input_bytes=_content_length(request_headers),
                client_job_id=client_job_id,
            )
        except Exception:
            # Bookkeeping must never decide whether a user's request works.
            logger.exception('job tracker: could not record the start of a %s request; running it untracked', tool)
            joblog.mark_finished(client_job_id)
            await self.app(scope, receive, send)
            return

        response: dict = {'code': None, 'category_header': None, 'data_warning': None, 'body': bytearray()}

        async def send_wrapper(message) -> None:
            try:
                if message['type'] == 'http.response.start':
                    response['code'] = message['status']
                    for name, value in message.get('headers') or []:
                        if name.lower() == CATEGORY_HEADER.encode():
                            response['category_header'] = value.decode('latin-1').strip()
                        elif name.lower() == WARNING_HEADER.lower().encode():
                            response['data_warning'] = value.decode('latin-1').strip() or None
                elif message['type'] == 'http.response.body':
                    code = response['code']
                    room = MAX_ERROR_BODY_BYTES - len(response['body'])
                    if code is not None and code >= 400 and room > 0:
                        response['body'].extend((message.get('body') or b'')[:room])
            except Exception:
                logger.debug('job tracker: could not inspect a response message', exc_info=True)
            await send(message)

        token = current_job_id.set(job_id)
        client_token = current_client_job_id.set(client_job_id)
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            logger.exception('Job %s (%s) failed with an unhandled %s', job_id, tool, type(exc).__name__)
            _record_crash(job_id, exc)
            raise
        else:
            # A status was always captured unless the app crashed before ever
            # sending 'http.response.start' (already handled by the except
            # branch above), so the 500 fallback is just defensive.
            _record_response(job_id, response)
        finally:
            try:
                current_job_id.reset(token)
                current_client_job_id.reset(client_token)
            except ValueError:
                pass
            joblog.mark_finished(client_job_id)


def _client_job_id(request_headers: dict) -> Optional[str]:
    """The browser's job id when it sent a valid one that is not already in
    use, else None (the request then runs without a live log)."""
    supplied = request_headers.get(CLIENT_JOB_ID_HEADER, b'').decode('latin-1').strip()
    try:
        return supplied if supplied and joblog.register(supplied) else None
    except Exception:
        logger.debug('job tracker: could not register a live log', exc_info=True)
        return None


def _live_line(level: str, message: str) -> None:
    """One line in the current request's live log (nothing when it has none)."""
    try:
        client_job_id = current_client_job_id.get()
        if client_job_id:
            joblog.append(client_job_id, level, message)
    except Exception:
        logger.debug('job tracker: could not write a live log line', exc_info=True)


_MESSAGE_IN_BODY = re.compile(r'"(?:message|msg)"\s*:\s*"((?:[^"\\]|\\.)*)"')


def _failure_line(status_code: int, body_text: Optional[str]) -> str:
    """'Failed (HTTP 422): <what the response says>' for the live log."""
    said = None
    if body_text:
        try:
            body = json.loads(body_text)
        except ValueError:
            body = None
            found = _MESSAGE_IN_BODY.search(body_text)  # the body was cut off at 2 KB
            if found:
                try:
                    said = json.loads(f'"{found.group(1)}"')
                except ValueError:
                    said = found.group(1)
        if isinstance(body, dict):
            error = body.get('error')
            if isinstance(error, dict) and isinstance(error.get('message'), str):
                said = error['message']
            elif isinstance(body.get('msg'), str):
                detail = body.get('detail')
                said = body['msg'] + (f': {detail}' if isinstance(detail, str) and detail else '')
    return f'Failed (HTTP {status_code})' + (f': {said}' if said else '.')


def _source_of(request_headers: dict) -> str:
    """'canary' when the request carries the shared canary token, else 'user'.
    With CANARY_TOKEN unset nothing can claim to be a canary."""
    expected = os.environ.get('CANARY_TOKEN', '')
    supplied = request_headers.get(CANARY_HEADER, b'').decode('latin-1')
    if expected and supplied and hmac.compare_digest(expected, supplied):
        return 'canary'
    return 'user'


def _content_length(request_headers: dict) -> Optional[int]:
    try:
        return int(request_headers[b'content-length'])
    except (KeyError, ValueError):
        return None


def _record_crash(job_id: str, exc: Exception) -> None:
    try:
        category, error_type = classify(exc, None, None)
        _live_line('ERROR', f'Failed: {type(exc).__name__}: {exc}')
        finish_job(
            job_id,
            status='failed',
            status_code=None,
            error=f'{type(exc).__name__}: {exc}',
            error_category=category,
            error_type=error_type,
            error_detail=describe_exception(exc),
            traceback_hash=traceback_hash(exc),
        )
    except Exception:
        logger.exception('job tracker: could not record the failure of job %s', job_id)


def _record_response(job_id: str, response: dict) -> None:
    try:
        status_code = response['code'] if response['code'] is not None else 500
        if status_code < 400:
            _live_line('INFO', f'Finished (HTTP {status_code}).')
            finish_job(job_id, status='completed', status_code=status_code, data_warning=response.get('data_warning'))
            return

        headers = {CATEGORY_HEADER: response['category_header']} if response['category_header'] else {}
        category, error_type = classify(None, status_code, headers)
        detail = bytes(response['body']).decode('utf-8', errors='replace').strip() or None
        if category == 'data_contract' and detail:
            error_type = _contract_code(detail) or error_type
        _live_line('ERROR', _failure_line(status_code, detail))
        finish_job(
            job_id,
            status='failed',
            status_code=status_code,
            error=f'HTTP {status_code}',
            error_category=category,
            error_type=error_type,
            error_detail=detail,
        )
    except Exception:
        logger.exception('job tracker: could not record the result of job %s', job_id)


def _contract_code(body_text: str) -> Optional[str]:
    """A short name for a data_contract failure: the `error.code` of a
    DataContractError response (e.g. 'missing_columns'), or the `msg` of a
    ToolBoxExceptions response (e.g. 'Invalid Input'). None when the body
    was cut off by the 2 KB cap or is not either shape."""
    try:
        body = json.loads(body_text)
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get('error')
    label = error.get('code') if isinstance(error, dict) else body.get('msg')
    return label[:60] if isinstance(label, str) and label else None
