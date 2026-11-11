"""Tests for the upload size limit (hardening item: upload size limits, HTTP 413).

Run from the repo root:  python -m unittest tests.test_upload_limit -v
"""
import asyncio
import json
import os
import unittest
from unittest import mock

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from toolbox.job_tracker.classify import classify, is_counted
from toolbox.utils import upload_limit
from toolbox.utils.upload_limit import UploadSizeLimitMiddleware, max_upload_bytes, too_large_body, upload_limit_enabled

MB = 1024 * 1024


def scope(method='POST', path='/qc/validation', length=None, kind='http'):
    headers = [(b'content-type', b'multipart/form-data; boundary=x')]
    if length is not None:
        headers.append((b'content-length', str(length).encode()))
    return {'type': kind, 'method': method, 'path': path, 'headers': headers}


class Client:
    """Feeds a request body in chunks and records what the app sends back."""

    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.sent = []

    async def receive(self):
        if self.chunks:
            body = self.chunks.pop(0)
            return {'type': 'http.request', 'body': body, 'more_body': bool(self.chunks)}
        return {'type': 'http.disconnect'}

    async def send(self, message):
        self.sent.append(message)

    @property
    def status(self):
        return next(m['status'] for m in self.sent if m['type'] == 'http.response.start')

    @property
    def headers(self):
        start = next(m for m in self.sent if m['type'] == 'http.response.start')
        return {k.decode(): v.decode() for k, v in start['headers']}

    @property
    def json(self):
        return json.loads(b''.join(m.get('body', b'') for m in self.sent if m['type'] == 'http.response.body'))


def reading_app(calls):
    """A route that reads the whole body, then answers 200 with the byte count."""
    async def app(scope, receive, send):
        calls.append(scope['path'])
        total = 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                raise ConnectionError('client went away')
            total += len(message.get('body') or b'')
            if not message.get('more_body'):
                break
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': str(total).encode()})
    return app


def parse_error_app(calls):
    """Like FastAPI: a body that cannot be read becomes its own 400 answer."""
    async def app(scope, receive, send):
        calls.append(scope['path'])
        try:
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    raise ConnectionError('client disconnected')
                if not message.get('more_body'):
                    break
        except ConnectionError:
            await send({'type': 'http.response.start', 'status': 400, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'{"detail":"There was an error parsing the body"}'})
            return
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'ok'})
    return app


def limit_env(limit_mb, enabled='1'):
    """Environment for a test of the limit itself: the check is off unless UPLOAD_LIMIT_ENABLED is set."""
    env = {}
    if limit_mb is not None:
        env['MAX_UPLOAD_MB'] = limit_mb
    if enabled is not None:
        env['UPLOAD_LIMIT_ENABLED'] = enabled
    return env


def run(app, scope_, chunks, limit_mb='1', enabled='1'):
    client = Client(chunks)
    with mock.patch.dict(os.environ, limit_env(limit_mb, enabled), clear=False):
        if limit_mb is None:
            os.environ.pop('MAX_UPLOAD_MB', None)
        if enabled is None:
            os.environ.pop('UPLOAD_LIMIT_ENABLED', None)
        asyncio.run(UploadSizeLimitMiddleware(app)(scope_, client.receive, client.send))
    return client


class TestLimitSetting(unittest.TestCase):
    def test_check_is_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('MAX_UPLOAD_MB', None)
            os.environ.pop('UPLOAD_LIMIT_ENABLED', None)
            self.assertFalse(upload_limit_enabled())
            self.assertIsNone(max_upload_bytes())

    def test_a_leftover_max_upload_mb_does_not_turn_it_on(self):
        with mock.patch.dict(os.environ, {'MAX_UPLOAD_MB': '50'}):
            os.environ.pop('UPLOAD_LIMIT_ENABLED', None)
            self.assertIsNone(max_upload_bytes())

    def test_only_explicit_values_enable_it(self):
        for value in ('1', 'true', 'TRUE', 'yes', 'on', ' On '):
            with self.subTest(value=value), mock.patch.dict(os.environ, {'UPLOAD_LIMIT_ENABLED': value}):
                self.assertTrue(upload_limit_enabled())
        for value in ('', '0', 'false', 'no', 'off', 'maybe'):
            with self.subTest(value=value), mock.patch.dict(os.environ, {'UPLOAD_LIMIT_ENABLED': value}):
                self.assertFalse(upload_limit_enabled())

    def test_default_limit_when_enabled_is_200_mb(self):
        with mock.patch.dict(os.environ, limit_env(None), clear=False):
            os.environ.pop('MAX_UPLOAD_MB', None)
            self.assertEqual(max_upload_bytes(), 200 * MB)

    def test_custom_value(self):
        with mock.patch.dict(os.environ, limit_env('50')):
            self.assertEqual(max_upload_bytes(), 50 * MB)

    def test_fractional_value(self):
        with mock.patch.dict(os.environ, limit_env('0.5')):
            self.assertEqual(max_upload_bytes(), MB // 2)

    def test_zero_switches_the_check_off_even_when_enabled(self):
        with mock.patch.dict(os.environ, limit_env('0')):
            self.assertIsNone(max_upload_bytes())

    def test_garbage_falls_back_to_default(self):
        with mock.patch.dict(os.environ, limit_env('lots')):
            self.assertEqual(max_upload_bytes(), 200 * MB)

    def test_blank_falls_back_to_default(self):
        with mock.patch.dict(os.environ, limit_env('  ')):
            self.assertEqual(max_upload_bytes(), 200 * MB)


class TestDeclaredSize(unittest.TestCase):
    def test_small_upload_reaches_the_route_intact(self):
        calls = []
        client = run(reading_app(calls), scope(length=1000), [b'a' * 400, b'b' * 600])
        self.assertEqual(client.status, 200)
        self.assertEqual(calls, ['/qc/validation'])
        self.assertEqual(b''.join(m.get('body', b'') for m in client.sent if m['type'] == 'http.response.body'), b'1000')

    def test_exactly_at_the_limit_is_allowed(self):
        calls = []
        client = run(reading_app(calls), scope(length=MB), [b'a' * MB])
        self.assertEqual(client.status, 200)

    def test_one_byte_over_is_refused(self):
        calls = []
        client = run(reading_app(calls), scope(length=MB + 1), [b'a' * (MB + 1)])
        self.assertEqual(client.status, 413)

    def test_refusal_never_reaches_the_route_or_reads_the_body(self):
        calls = []
        client = run(reading_app(calls), scope(length=5 * MB), [b'a' * 10])
        self.assertEqual(client.status, 413)
        self.assertEqual(calls, [])
        self.assertEqual(len(client.chunks), 1, 'the body must not have been read')

    def test_refusal_message_is_readable_and_names_the_sizes(self):
        client = run(reading_app([]), scope(length=int(5.5 * MB)), [])
        body = client.json
        self.assertEqual(body['status_code'], 413)
        self.assertEqual(body['msg'], 'Upload too large')
        self.assertIn('5.5 MB', body['detail'])
        self.assertIn('1.0 MB', body['detail'])

    def test_refusal_is_filed_as_user_input_not_a_crash(self):
        client = run(reading_app([]), scope(length=5 * MB), [])
        self.assertEqual(client.headers['x-error-category'], 'user_input')
        self.assertEqual(client.headers['content-type'], 'application/json')
        self.assertEqual(client.headers['connection'], 'close')
        self.assertEqual(int(client.headers['content-length']), len(json.dumps(client.json)))

    def test_every_checked_method(self):
        for method in ('POST', 'PUT', 'PATCH'):
            with self.subTest(method=method):
                client = run(reading_app([]), scope(method=method, length=5 * MB), [])
                self.assertEqual(client.status, 413)


class TestStreamedSize(unittest.TestCase):
    def test_no_content_length_under_limit_passes(self):
        calls = []
        client = run(reading_app(calls), scope(), [b'a' * 300, b'b' * 300])
        self.assertEqual(client.status, 200)

    def test_no_content_length_over_limit_is_cut_off_with_413(self):
        calls = []
        chunks = [b'a' * (MB // 2)] * 4  # 2 MB against a 1 MB limit
        client = run(reading_app(calls), scope(), chunks)
        self.assertEqual(client.status, 413)
        self.assertEqual(client.headers['x-error-category'], 'user_input')

    def test_stops_reading_once_over(self):
        chunks = [b'a' * (MB // 2)] * 10
        client = run(reading_app([]), scope(), chunks)
        self.assertEqual(client.status, 413)
        self.assertGreater(len(client.chunks), 5, 'should stop pulling data long before the end')

    def test_a_route_that_answers_400_for_the_cut_off_body_still_gives_413(self):
        client = run(parse_error_app([]), scope(), [b'a' * (MB // 2)] * 4)
        self.assertEqual(client.status, 413)
        starts = [m for m in client.sent if m['type'] == 'http.response.start']
        self.assertEqual(len(starts), 1, 'exactly one response')

    def test_a_route_that_crashes_when_cut_off_still_gives_413(self):
        client = run(reading_app([]), scope(), [b'a' * (MB // 2)] * 4)
        self.assertEqual(client.status, 413)

    def test_a_real_crash_below_the_limit_still_propagates(self):
        async def broken(scope, receive, send):
            raise ValueError('bug in the tool')

        with self.assertRaises(ValueError):
            run(broken, scope(length=10), [b'x' * 10])

    def test_unparseable_content_length_is_counted_instead(self):
        client = run(reading_app([]), {**scope(), 'headers': [(b'content-length', b'abc')]}, [b'a' * (MB // 2)] * 4)
        self.assertEqual(client.status, 413)

    def test_declared_small_but_actually_large_is_still_caught(self):
        client = run(reading_app([]), scope(length=100), [b'a' * (MB // 2)] * 4)
        self.assertEqual(client.status, 413)


class TestNotApplied(unittest.TestCase):
    def test_get_is_never_checked(self):
        calls = []
        client = run(reading_app(calls), scope(method='GET', length=50 * MB), [b'x'])
        self.assertEqual(client.status, 200)
        self.assertEqual(calls, ['/qc/validation'])

    def test_non_http_scopes_pass_through(self):
        seen = []

        async def app(scope_, receive, send):
            seen.append(scope_['type'])

        run(app, scope(kind='lifespan', length=50 * MB), [])
        run(app, scope(kind='websocket', length=50 * MB), [])
        self.assertEqual(seen, ['lifespan', 'websocket'])

    def test_zero_lets_everything_through(self):
        calls = []
        client = run(reading_app(calls), scope(length=500 * MB), [b'a' * 10], limit_mb='0')
        self.assertEqual(client.status, 200)
        self.assertEqual(calls, ['/qc/validation'])

    def test_disabled_by_default_lets_everything_through(self):
        """With UPLOAD_LIMIT_ENABLED unset, even a tiny MAX_UPLOAD_MB refuses nothing."""
        calls = []
        client = run(reading_app(calls), scope(length=500 * MB), [b'a' * 10], enabled=None)
        self.assertEqual(client.status, 200)
        self.assertEqual(calls, ['/qc/validation'])

    def test_disabled_by_default_does_not_cut_off_a_streamed_body(self):
        calls = []
        client = run(reading_app(calls), scope(), [b'a' * (MB // 2)] * 4, enabled=None)
        self.assertEqual(client.status, 200)
        self.assertEqual(b''.join(m.get('body', b'') for m in client.sent if m['type'] == 'http.response.body'), str(2 * MB).encode())


class TestHowItIsFiled(unittest.TestCase):
    def test_413_is_a_user_input_failure_and_not_counted_against_success_rate(self):
        category, error_type = classify(None, 413, {'x-error-category': 'user_input'})
        self.assertEqual((category, error_type), ('user_input', 'HTTP 413'))
        self.assertFalse(is_counted(category))

    def test_413_without_the_header_is_still_user_input(self):
        self.assertEqual(classify(None, 413, {})[0], 'user_input')

    def test_body_shape_matches_what_the_frontend_already_reads(self):
        body = too_large_body(200 * MB, 300 * MB)
        self.assertEqual(set(body), {'msg', 'detail', 'status_code'})
        self.assertIn('300.0 MB', body['detail'])
        self.assertNotIn('which is over', too_large_body(MB, None)['detail'])


class TestWiring(unittest.TestCase):
    """The app must add the limit before CORS so the 413 carries CORS headers and is tracked."""

    def test_limit_is_added_before_cors_and_the_job_tracker(self):
        path = os.path.join(os.path.dirname(upload_limit.__file__), '..', 'sda_toolbox.py')
        with open(path, encoding='utf-8') as handle:
            source = handle.read()
        limit = source.index('UploadSizeLimitMiddleware)')
        cors = source.index('app.add_middleware(\n    CORSMiddleware')
        tracker = source.index('app.add_middleware(JobLoggingMiddleware)')
        self.assertLess(limit, cors)
        self.assertLess(cors, tracker)


if __name__ == '__main__':
    unittest.main()
