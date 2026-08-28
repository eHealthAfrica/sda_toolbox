from starlette.types import ASGIApp, Receive, Scope, Send

from toolbox.job_tracker.store import start_job, finish_job

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
        client = scope.get('client')
        client_host = client[0] if client else None
        job_id = start_job(
            tool=tool,
            label=label,
            method=scope['method'],
            path=scope['path'],
            client_host=client_host,
        )

        status_holder: dict[str, int | None] = {'code': None}

        async def send_wrapper(message) -> None:
            if message['type'] == 'http.response.start':
                status_holder['code'] = message['status']
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            finish_job(job_id, status='failed', status_code=None, error=f'{type(exc).__name__}: {exc}')
            raise

        # A status was always captured unless the app crashed before ever
        # sending 'http.response.start' (already handled by the except
        # branch above), so this fallback is just defensive.
        status_code = status_holder['code'] if status_holder['code'] is not None else 500
        status = 'completed' if status_code < 400 else 'failed'
        error = None if status == 'completed' else f'HTTP {status_code}'
        finish_job(job_id, status=status, status_code=status_code, error=error)
