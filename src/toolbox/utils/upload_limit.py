"""Refuse oversized uploads with a clear HTTP 413 instead of letting them exhaust memory.

Every analysis route reads the whole upload into memory (and pandas then holds several copies
of it), so one very large file can take the API down for everyone. This middleware checks the
size of a request before the route sees it:

  * when the request declares its size (Content-Length), a request over the limit is refused at
    once, without reading any of the body;
  * when it does not (chunked upload), the body is counted as it arrives and the request is cut
    off the moment it passes the limit.

The limit applies to the whole request, so a route that takes several files counts them together.
THE CHECK IS OFF. Nothing is refused unless UPLOAD_LIMIT_ENABLED is set to 1/true/yes/on. Only then
does MAX_UPLOAD_MB (default 200; 0 also turns it off) set the limit. A leftover MAX_UPLOAD_MB in a .env
file therefore cannot switch the check back on by itself.

The 413 answer uses the same {msg, detail, status_code} shape as the tool exceptions, so the
frontend shows it as a normal readable error, and it is tagged X-Error-Category: user_input so
the job tracker files it as the caller's problem rather than a crash.
"""
import json
import logging
import os
from typing import Optional

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

DEFAULT_MAX_UPLOAD_MB = 200
ENABLE_VARIABLE = 'UPLOAD_LIMIT_ENABLED'
CHECKED_METHODS = frozenset({'POST', 'PUT', 'PATCH'})
CATEGORY_HEADER = b'x-error-category'
MB = 1024 * 1024


def upload_limit_enabled() -> bool:
    """False unless UPLOAD_LIMIT_ENABLED is 1/true/yes/on: the size check is off by default."""
    return os.environ.get(ENABLE_VARIABLE, '').strip().lower() in ('1', 'true', 'yes', 'on')


def max_upload_bytes() -> Optional[int]:
    """The limit in bytes, or None when the check is off (the default, or MAX_UPLOAD_MB=0)."""
    if not upload_limit_enabled():
        return None
    raw = os.environ.get('MAX_UPLOAD_MB')
    if raw is None or not raw.strip():
        megabytes = DEFAULT_MAX_UPLOAD_MB
    else:
        try:
            megabytes = float(raw)
        except ValueError:
            logger.warning('MAX_UPLOAD_MB=%r is not a number; using %s MB', raw, DEFAULT_MAX_UPLOAD_MB)
            megabytes = DEFAULT_MAX_UPLOAD_MB
    if megabytes <= 0:
        return None
    return int(megabytes * MB)


def _size_text(size: float) -> str:
    return f'{size / MB:,.1f} MB'


def too_large_body(limit: int, size: Optional[int]) -> dict:
    sent = f'This upload is {_size_text(size)}, which is ' if size is not None else 'This upload is '
    return {
        'msg': 'Upload too large',
        'detail': (
            f'{sent}over the {_size_text(limit)} limit for a single request. '
            'Split it into smaller files, or remove columns and rows you do not need, and try again.'
        ),
        'status_code': 413,
    }


async def _send_too_large(send: Send, limit: int, size: Optional[int]) -> None:
    payload = json.dumps(too_large_body(limit, size)).encode('utf-8')
    await send({
        'type': 'http.response.start',
        'status': 413,
        'headers': [
            (b'content-type', b'application/json'),
            (b'content-length', str(len(payload)).encode('ascii')),
            (CATEGORY_HEADER, b'user_input'),
            # The client may still be sending the rest of the file; closing the connection stops it.
            (b'connection', b'close'),
        ],
    })
    await send({'type': 'http.response.body', 'body': payload})


def _declared_length(scope: Scope) -> Optional[int]:
    for name, value in scope.get('headers') or []:
        if name == b'content-length':
            try:
                length = int(value)
            except ValueError:
                return None
            return length if length >= 0 else None
    return None


class UploadSizeLimitMiddleware:
    """Plain ASGI middleware (not BaseHTTPMiddleware), so it never buffers a response body.

    Add it BEFORE the CORS and job-tracker middleware in sda_toolbox.py so it is the innermost
    layer: that way the 413 still carries the CORS headers the browser needs to read it, and the
    job tracker records the refusal.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http' or scope['method'] not in CHECKED_METHODS:
            await self.app(scope, receive, send)
            return

        limit = max_upload_bytes()
        if limit is None:
            await self.app(scope, receive, send)
            return

        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            logger.warning('Refused %s %s: %s declared, limit %s', scope['method'], scope['path'], _size_text(declared), _size_text(limit))
            await _send_too_large(send, limit, declared)
            return

        state = {'received': 0, 'exceeded': False, 'answered': False}

        async def counting_receive() -> Message:
            if state['exceeded']:
                return {'type': 'http.disconnect'}
            message = await receive()
            if message['type'] == 'http.request':
                state['received'] += len(message.get('body') or b'')
                if state['received'] > limit:
                    state['exceeded'] = True
                    logger.warning('Refused %s %s: body passed the %s limit while streaming', scope['method'], scope['path'], _size_text(limit))
                    # Tell the route the client went away; the answer below replaces whatever it says.
                    return {'type': 'http.disconnect'}
            return message

        async def guarded_send(message: Message) -> None:
            if state['exceeded']:
                # Whatever the route says after being cut off (often a 400 "error parsing the body")
                # is replaced by one 413.
                if not state['answered']:
                    state['answered'] = True
                    await _send_too_large(send, limit, None)
                return
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if not state['exceeded']:
                raise
            logger.debug('Route failed after its upload was cut off', exc_info=True)

        if state['exceeded'] and not state['answered']:
            state['answered'] = True
            await _send_too_large(send, limit, None)
