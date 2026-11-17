"""Behaviour tests for the reliability backend (Phase 1 + health checks).

Run from /home/claude/work:  python3 -m unittest tests.test_reliability -v
Uses a throwaway SQLite file; touches nothing else.
"""
import asyncio
import json
import logging
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'src'))
sys.path.insert(0, os.path.join(HERE, 'shims'))  # test-only FastAPI stand-in

TMP = tempfile.mkdtemp(prefix='reliability-test-')
DB = os.path.join(TMP, 'jobs.sqlite3')
os.environ['JOBS_DB_PATH'] = DB
os.environ.pop('SLO_EXCLUDED_CATEGORIES', None)

# A database written by the OLD code: old schema, no new columns, mixed history.
_legacy = sqlite3.connect(DB)
_legacy.executescript("""
CREATE TABLE jobs (id TEXT PRIMARY KEY, tool TEXT NOT NULL, label TEXT NOT NULL, method TEXT NOT NULL,
  path TEXT NOT NULL, status TEXT NOT NULL, status_code INTEGER, client_host TEXT, started_at TEXT NOT NULL,
  ended_at TEXT, duration_ms INTEGER, error TEXT);
INSERT INTO jobs VALUES ('l1','reach','REACH','POST','/validation','completed',200,NULL,'2026-10-01T10:00:00+00:00','2026-10-01T10:00:05+00:00',5000,NULL);
INSERT INTO jobs VALUES ('l2','reach','REACH','POST','/validation','failed',404,NULL,'2026-10-01T11:00:00+00:00','2026-10-01T11:00:01+00:00',1000,'HTTP 404');
INSERT INTO jobs VALUES ('l3','reach','REACH','POST','/validation','failed',500,NULL,'2026-10-01T12:00:00+00:00','2026-10-01T12:00:01+00:00',1000,'HTTP 500');
INSERT INTO jobs VALUES ('l4','h2h','H2H','POST','/tracking/gridded','failed',NULL,NULL,'2026-10-01T13:00:00+00:00','2026-10-01T13:00:01+00:00',1000,'interrupted — backend restarted');
INSERT INTO jobs VALUES ('l5','h2h','H2H','POST','/tracking/gridded','failed',504,NULL,'2026-10-01T14:00:00+00:00','2026-10-01T14:00:01+00:00',1000,'HTTP 504');
INSERT INTO jobs VALUES ('l6','h2h','H2H','POST','/tracking/gridded','active',NULL,NULL,'2026-10-01T15:00:00+00:00',NULL,NULL,NULL);
""")
_legacy.commit()
_legacy.close()

from starlette.applications import Starlette  # noqa: E402
from starlette.responses import JSONResponse, PlainTextResponse, StreamingResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402

from toolbox.errors import DataContractError, data_contract_error_handler  # noqa: E402
from toolbox.job_tracker import store, incidents, stats, health, classify  # noqa: E402
from toolbox.job_tracker.middleware import JobLoggingMiddleware, MAX_ERROR_BODY_BYTES  # noqa: E402
from toolbox.job_tracker import context  # noqa: E402

UTC = timezone.utc

# State right after start-up (migration + reconcile), captured before any test mutates the tables.
_conn = sqlite3.connect(DB)
_conn.row_factory = sqlite3.Row
AFTER_STARTUP = {
    'columns': {r['name'] for r in _conn.execute('PRAGMA table_info(jobs)')},
    'jobs': {r['id']: dict(r) for r in _conn.execute('SELECT * FROM jobs')},
    'incidents': [dict(r) for r in _conn.execute("SELECT * FROM incidents WHERE tool = 'h2h'")],
}
_conn.close()


def rows(sql, *params):
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def reset():
    with store.connect() as conn:
        conn.execute('DELETE FROM jobs')
        conn.execute('DELETE FROM incidents')


def add_job(tool='reach', status='completed', category=None, started=None, ended=None, duration=1000,
            error_type=None, tb=None, source='user', detail=None, label='REACH'):
    jid = f'{tool}-{os.urandom(4).hex()}'
    started = started or datetime.now(UTC)
    ended = ended or started + timedelta(milliseconds=duration)
    with store.connect() as conn:
        conn.execute(
            'INSERT INTO jobs (id, tool, label, method, path, status, status_code, started_at, ended_at, '
            'duration_ms, error, error_category, error_type, error_detail, traceback_hash, source) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (jid, tool, label, 'POST', '/x', status, 200 if status == 'completed' else 500,
             started.isoformat(), ended.isoformat(), duration, None if status == 'completed' else 'err',
             category, error_type, detail, tb, source),
        )
    return jid


def finish(jid, status, category=None, error_type=None):
    """Mark a job finished through the real store.finish_job (incident hooks included)."""
    store.finish_job(jid, status, 200 if status == 'completed' else 500,
                     None if status == 'completed' else 'err',
                     error_category=category, error_type=error_type)


def start(tool='reach', label='REACH'):
    return store.start_job(tool, label, 'POST', '/x', None)


# --------------------------------------------------------------------- ASGI
async def asgi_call(app, method='POST', path='/tracking/devices', headers=None, body=b''):
    sent = []
    scope = {
        'type': 'http', 'method': method, 'path': path, 'raw_path': path.encode(), 'query_string': b'',
        'headers': [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        'client': ('10.0.0.1', 5000), 'server': ('test', 80), 'scheme': 'http', 'http_version': '1.1',
        'root_path': '',
    }

    delivered = []

    async def receive():
        if not delivered:
            delivered.append(True)
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await asyncio.sleep(3600)  # a real server only reports a disconnect later; streaming waits on this
        return {'type': 'http.disconnect'}

    async def send(message):
        sent.append(message)

    raised = None
    try:
        await app(scope, receive, send)
    except Exception as exc:  # noqa: BLE001
        raised = exc
    return sent, raised


def make_app(handler, **kwargs):
    app = Starlette(
        routes=[Route('/tracking/devices', handler, methods=['POST']),
                Route('/other', handler, methods=['POST'])],
        exception_handlers={DataContractError: data_contract_error_handler},
        **kwargs,
    )
    app.add_middleware(JobLoggingMiddleware)
    return app


def latest_job():
    return rows('SELECT * FROM jobs ORDER BY started_at DESC LIMIT 1')[0]


# ======================================================================
class Migration(unittest.TestCase):
    def test_columns_backfill_and_reconcile(self):
        cols = AFTER_STARTUP['columns']
        for c in ('error_category', 'error_type', 'error_detail', 'traceback_hash', 'stage', 'source', 'input_bytes'):
            self.assertIn(c, cols)
        by_id = AFTER_STARTUP['jobs']
        self.assertEqual(by_id['l1']['error_category'], None)
        self.assertEqual(by_id['l1']['source'], 'user')
        self.assertEqual(by_id['l2']['error_category'], 'user_input')
        self.assertEqual(by_id['l3']['error_category'], 'code_error')
        self.assertEqual(by_id['l4']['error_category'], 'interrupted')
        self.assertEqual(by_id['l5']['error_category'], 'resource')
        # the row that was 'active' at start-up
        self.assertEqual(by_id['l6']['status'], 'failed')
        self.assertEqual(by_id['l6']['error_category'], 'interrupted')
        # ...and it opened an incident for h2h
        inc = AFTER_STARTUP['incidents']
        self.assertEqual(len(inc), 1)
        self.assertEqual(inc[0]['status'], 'open')

    def test_indexes_exist_and_init_is_idempotent(self):
        store.init_db()
        store.init_db()
        names = {r['name'] for r in rows("SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertIn('idx_jobs_tool_started', names)
        self.assertIn('idx_jobs_category', names)
        self.assertIn('idx_incidents_status', names)


class Classify(unittest.TestCase):
    def test_exceptions(self):
        self.assertEqual(classify.classify(ValueError('x'), None), ('code_error', 'ValueError'))
        self.assertEqual(classify.classify(TimeoutError(), None)[0], 'resource')
        self.assertEqual(classify.classify(MemoryError(), None)[0], 'resource')
        import errno
        self.assertEqual(classify.classify(OSError(errno.ENOSPC, 'no space'), None)[0], 'resource')
        self.assertEqual(classify.classify(OSError(errno.ENOENT, 'missing'), None)[0], 'code_error')
        self.assertEqual(classify.classify(ConnectionRefusedError(), None)[0], 'dependency')
        self.assertEqual(classify.classify(DataContractError('c', 'm'), None), ('data_contract', 'DataContractError'))

        # lookalikes for third-party exceptions (module-prefix matching)
        sa_op = type('OperationalError', (Exception,), {'__module__': 'sqlalchemy.exc'})
        self.assertEqual(classify.classify(sa_op('db down'), None)[0], 'dependency')
        pg_op = type('OperationalError', (Exception,), {'__module__': 'psycopg2'})
        self.assertEqual(classify.classify(pg_op(), None)[0], 'dependency')
        httpx_err = type('ConnectError', (Exception,), {'__module__': 'httpx'})
        self.assertEqual(classify.classify(httpx_err(), None)[0], 'dependency')
        other_op = type('OperationalError', (Exception,), {'__module__': 'mylib'})
        self.assertEqual(classify.classify(other_op(), None)[0], 'code_error')

    def test_status_codes(self):
        for code in (400, 404, 405, 413, 415, 422):
            self.assertEqual(classify.classify(None, code, {})[0], 'user_input', code)
        self.assertEqual(classify.classify(None, 500, {}), ('code_error', 'HTTP 500'))
        self.assertEqual(classify.classify(None, 504, {})[0], 'resource')
        self.assertEqual(classify.classify(None, 502, {})[0], 'dependency')
        self.assertEqual(classify.classify(None, 503, {})[0], 'dependency')
        self.assertEqual(classify.classify(None, 422, {'x-error-category': 'data_contract'})[0], 'data_contract')
        # an unknown header value is ignored
        self.assertEqual(classify.classify(None, 422, {'x-error-category': 'bogus'})[0], 'user_input')

    def test_counted_and_env_override(self):
        self.assertTrue(classify.is_counted('code_error'))
        self.assertTrue(classify.is_counted('interrupted'))
        self.assertFalse(classify.is_counted('user_input'))
        self.assertFalse(classify.is_counted('data_contract'))
        self.assertTrue(classify.is_counted(None))
        os.environ['SLO_EXCLUDED_CATEGORIES'] = 'user_input'
        try:
            self.assertTrue(classify.is_counted('data_contract'))
            self.assertFalse(classify.is_counted('user_input'))
        finally:
            os.environ.pop('SLO_EXCLUDED_CATEGORIES')

    def test_traceback_hash_is_stable_and_discriminating(self):
        def boom(kind):
            raise kind('x')

        def catch(kind):
            try:
                boom(kind)
            except Exception as e:  # noqa: BLE001
                return e

        a, b, c = catch(ValueError), catch(ValueError), catch(KeyError)
        self.assertEqual(classify.traceback_hash(a), classify.traceback_hash(a))
        self.assertEqual(len(classify.traceback_hash(a)), 40)
        self.assertNotEqual(classify.traceback_hash(a), classify.traceback_hash(c))
        self.assertIsNone(classify.traceback_hash(ValueError('never raised')))
        detail = classify.describe_exception(a)
        self.assertTrue(detail.startswith('ValueError: x'))
        self.assertIn('test_reliability.py', detail)
        self.assertLessEqual(len(classify.describe_exception(ValueError('y' * 5000))), 2000)


class Middleware(unittest.TestCase):
    def setUp(self):
        reset()

    def run_app(self, handler, **kw):
        return asyncio.run(asgi_call(make_app(handler), **kw))

    def test_success_is_completed_and_untouched(self):
        async def ok(request):
            return PlainTextResponse('hello')
        sent, raised = self.run_app(ok, headers={'content-length': '123'})
        self.assertIsNone(raised)
        self.assertEqual(sent[0]['status'], 200)
        job = latest_job()
        self.assertEqual((job['status'], job['status_code'], job['source'], job['input_bytes']),
                         ('completed', 200, 'user', 123))
        self.assertIsNone(job['error_category'])
        self.assertEqual(rows('SELECT * FROM incidents'), [])

    def test_untracked_path_writes_nothing(self):
        async def ok(request):
            return PlainTextResponse('hello')
        self.run_app(ok, path='/other')
        self.assertEqual(rows('SELECT * FROM jobs'), [])

    def test_4xx_is_user_input_with_body_detail_and_no_incident(self):
        async def bad(request):
            return JSONResponse({'detail': 'file too large'}, status_code=413)
        sent, _ = self.run_app(bad)
        self.assertEqual(sent[0]['status'], 413)
        job = latest_job()
        self.assertEqual((job['status'], job['error_category'], job['error_type']), ('failed', 'user_input', 'HTTP 413'))
        self.assertIn('file too large', job['error_detail'])
        self.assertEqual(rows('SELECT * FROM incidents'), [])

    def test_data_contract_error_is_422_with_header_and_not_an_incident(self):
        async def contract(request):
            raise DataContractError('missing_columns', 'Missing columns.', {'missing': ['lat']})
        sent, raised = self.run_app(contract)
        self.assertIsNone(raised)
        self.assertEqual(sent[0]['status'], 422)
        self.assertIn((b'x-error-category', b'data_contract'), sent[0]['headers'])
        body = json.loads(b''.join(m.get('body', b'') for m in sent if m['type'] == 'http.response.body'))
        self.assertEqual(body['error']['code'], 'missing_columns')
        job = latest_job()
        self.assertEqual((job['error_category'], job['error_type']), ('data_contract', 'missing_columns'))
        self.assertEqual(rows('SELECT * FROM incidents'), [])

    def test_user_data_exceptions_are_tagged_and_not_counted(self):
        from toolbox.exceptions import (InvalidInputError, NoRecordsFound, FileNotFound, NotSupportedError,
                                        DataError, TableNotFound, MissingConfiguration)
        from toolbox.errors import category_headers
        for cls in (InvalidInputError, NoRecordsFound, FileNotFound, NotSupportedError, DataError):
            self.assertEqual(category_headers(cls('m', 'd')), {'X-Error-Category': 'data_contract'}, cls)
        for cls in (TableNotFound, MissingConfiguration, ValueError):
            self.assertEqual(category_headers(cls('m', 'd') if cls is not ValueError else cls('x')), {}, cls)

        # the same shape the ToolBoxExceptions handler in sda_toolbox.py sends
        async def handler(request):
            exc = InvalidInputError('Invalid Input', 'latitude column missing')
            return JSONResponse({'msg': exc.msg, 'detail': exc.details, 'status_code': 500}, status_code=500,
                                headers={'error': exc.msg, **category_headers(exc)})
        sent, _ = self.run_app(handler)
        self.assertEqual(sent[0]['status'], 500)  # the client still sees the original status
        job = latest_job()
        self.assertEqual((job['error_category'], job['error_type']), ('data_contract', 'Invalid Input'))
        self.assertEqual(rows('SELECT * FROM incidents'), [])

        # and a TableNotFound (untagged 500) is still a code error that opens an incident
        reset()

        async def table(request):
            exc = TableNotFound('Table Not Found', 'settlements')
            return JSONResponse({'msg': exc.msg}, status_code=500, headers={'error': exc.msg, **category_headers(exc)})
        self.run_app(table)
        self.assertEqual(latest_job()['error_category'], 'code_error')
        self.assertEqual(len(rows('SELECT * FROM incidents')), 1)

    def test_500_response_is_code_error_and_opens_incident(self):
        async def broken(request):
            return PlainTextResponse('server error', status_code=500)
        self.run_app(broken)
        job = latest_job()
        self.assertEqual((job['error_category'], job['error_type']), ('code_error', 'HTTP 500'))
        inc = rows('SELECT * FROM incidents')
        self.assertEqual(len(inc), 1)
        self.assertEqual((inc[0]['tool'], inc[0]['status'], inc[0]['severity'], inc[0]['failure_count']),
                         ('gts_device_tracking', 'open', 'sev3', 1))

    def test_unhandled_exception_is_recorded_hashed_and_reraised(self):
        async def crash(request):
            raise ValueError('stat: path too long for Windows')
        sent, raised = self.run_app(crash)
        # Starlette's outer ServerErrorMiddleware re-raises after sending its 500; either way the
        # client got a 500 and our middleware did not swallow anything.
        self.assertTrue(raised is not None or any(m.get('status') == 500 for m in sent))
        job = latest_job()
        self.assertEqual(job['status'], 'failed')
        self.assertEqual((job['error_category'], job['error_type']), ('code_error', 'ValueError'))
        self.assertTrue(job['error'].startswith('ValueError: stat: path too long'))
        self.assertEqual(len(job['traceback_hash']), 40)
        self.assertIn('ValueError: stat: path too long', job['error_detail'])
        self.assertIn('  at test_reliability.py', job['error_detail'])
        self.assertEqual(len(rows('SELECT * FROM incidents')), 1)

    def test_same_crash_gets_same_hash(self):
        async def crash(request):
            raise ValueError('boom')
        self.run_app(crash)
        self.run_app(crash)
        hashes = {r['traceback_hash'] for r in rows('SELECT traceback_hash FROM jobs')}
        self.assertEqual(len(hashes), 1)
        inc = rows('SELECT * FROM incidents')
        self.assertEqual((len(inc), inc[0]['failure_count']), (1, 2))

    def test_error_body_captured_but_forwarded_in_full(self):
        big = 'x' * 10000

        async def bad(request):
            return PlainTextResponse(big, status_code=500)
        sent, _ = self.run_app(bad)
        forwarded = b''.join(m.get('body', b'') for m in sent if m['type'] == 'http.response.body')
        self.assertEqual(len(forwarded), 10000)
        job = latest_job()
        self.assertEqual(len(job['error_detail']), 2000)  # 2 KB captured, then capped at 2000 characters
        self.assertGreaterEqual(MAX_ERROR_BODY_BYTES, 2000)

    def test_success_and_streaming_bodies_are_not_buffered_or_changed(self):
        chunks = [b'a' * 1000, b'b' * 1000, b'c' * 1000]

        async def stream(request):
            async def gen():
                for c in chunks:
                    yield c
            return StreamingResponse(gen(), media_type='application/octet-stream')

        sent, _ = self.run_app(stream)
        bodies = [m['body'] for m in sent if m['type'] == 'http.response.body' and m.get('body')]
        self.assertEqual(bodies, chunks)  # same messages, same boundaries
        job = latest_job()
        self.assertEqual(job['status'], 'completed')
        self.assertIsNone(job['error_detail'])

    def test_canary_header_needs_the_right_token(self):
        async def ok(request):
            return PlainTextResponse('ok')
        os.environ['CANARY_TOKEN'] = 's3cret'
        try:
            self.run_app(ok, headers={'X-Canary': 's3cret'})
            self.assertEqual(latest_job()['source'], 'canary')
            reset()
            self.run_app(ok, headers={'X-Canary': 'wrong'})
            self.assertEqual(latest_job()['source'], 'user')
        finally:
            del os.environ['CANARY_TOKEN']
        reset()
        self.run_app(ok, headers={'X-Canary': 's3cret'})  # no token configured -> can't claim canary
        self.assertEqual(latest_job()['source'], 'user')

    def test_bookkeeping_failure_never_changes_the_response(self):
        import toolbox.job_tracker.middleware as mw
        original_start, original_finish = mw.start_job, mw.finish_job

        async def ok(request):
            return PlainTextResponse('still fine')
        try:
            mw.start_job = lambda **kw: (_ for _ in ()).throw(sqlite3.OperationalError('disk I/O error'))
            sent, raised = self.run_app(ok)
            self.assertIsNone(raised)
            self.assertEqual(sent[0]['status'], 200)
            self.assertEqual(rows('SELECT * FROM jobs'), [])

            mw.start_job = original_start
            mw.finish_job = lambda *a, **kw: (_ for _ in ()).throw(sqlite3.OperationalError('locked'))
            sent, raised = self.run_app(ok)
            self.assertIsNone(raised)
            self.assertEqual(sent[0]['status'], 200)

            # and a crash in the app is not masked by a failing finish_job
            async def crash(request):
                raise KeyError('original problem')
            sent, raised = self.run_app(crash)
            self.assertTrue(raised is None or isinstance(raised, KeyError))
            self.assertTrue(raised is not None or sent[0]['status'] == 500)
        finally:
            mw.start_job, mw.finish_job = original_start, original_finish

    def test_contextvar_is_set_during_request_and_reset_after(self):
        seen = {}

        async def ok(request):
            seen['id'] = context.current_job_id.get()
            return PlainTextResponse('ok')
        self.run_app(ok)
        self.assertEqual(seen['id'], latest_job()['id'])
        self.assertIsNone(context.current_job_id.get())


class LogStamping(unittest.TestCase):
    def test_lines_during_a_job_get_the_id_prefix(self):
        import io
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
        root = logging.getLogger()
        root.addHandler(handler)
        old_level = root.level
        root.setLevel(logging.INFO)
        try:
            context.install_log_filter()
            context.install_log_filter()  # idempotent
            self.assertEqual(sum(isinstance(f, context.JobIdFilter) for f in handler.filters), 1)
            logging.info('outside any job')
            token = context.current_job_id.set('abcdef12-3456')
            try:
                logging.info('reading %s tracks', 42)
                logging.error(FileNotFoundError('x.csv'))  # message that is an exception object
            finally:
                context.current_job_id.reset(token)
            logging.info('after the job')
        finally:
            root.removeHandler(handler)
            root.setLevel(old_level)
        out = stream.getvalue().splitlines()
        self.assertEqual(out[0], 'INFO: outside any job')
        self.assertEqual(out[1], 'INFO: [job=abcdef12] reading 42 tracks')
        self.assertEqual(out[2], 'ERROR: [job=abcdef12] x.csv')
        self.assertEqual(out[3], 'INFO: after the job')

    def test_report_stage(self):
        reset()
        jid = start()
        token = context.current_job_id.set(jid)
        try:
            context.report_stage('reading tracks')
        finally:
            context.current_job_id.reset(token)
        context.report_stage('ignored outside a job')
        self.assertEqual(rows('SELECT stage FROM jobs WHERE id = ?', jid)[0]['stage'], 'reading tracks')


class IncidentLifecycle(unittest.TestCase):
    def setUp(self):
        reset()

    def test_first_failure_opens_next_failure_extends(self):
        a = start(); finish(a, 'failed', 'code_error', 'ValueError')
        b = start(); finish(b, 'failed', 'dependency', 'OperationalError')
        inc = rows('SELECT * FROM incidents')
        self.assertEqual(len(inc), 1)
        self.assertEqual((inc[0]['failure_count'], inc[0]['first_job_id'], inc[0]['last_job_id']), (2, a, b))
        self.assertEqual(inc[0]['title'], 'REACH: ValueError')

    def test_uncounted_failures_open_nothing(self):
        for cat in ('user_input', 'data_contract'):
            finish(start(), 'failed', cat, 'x')
        self.assertEqual(rows('SELECT * FROM incidents'), [])

    def test_one_incident_per_tool(self):
        finish(start('reach', 'REACH'), 'failed', 'code_error', 'E')
        finish(start('h2h', 'H2H'), 'failed', 'code_error', 'E')
        self.assertEqual(len(rows('SELECT * FROM incidents')), 2)

    def test_two_successes_auto_resolve_one_does_not(self):
        finish(start(), 'failed', 'code_error', 'E')
        finish(start(), 'completed')
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'open')
        finish(start(), 'completed')
        inc = rows('SELECT * FROM incidents')[0]
        self.assertEqual((inc['status'], inc['resolved_by']), ('resolved', 'auto'))
        self.assertTrue(inc['resolved_at'])
        self.assertIn('2 successful', inc['resolution'])

    def test_failure_between_successes_resets_the_streak(self):
        finish(start(), 'failed', 'code_error', 'E')
        finish(start(), 'completed')
        finish(start(), 'failed', 'code_error', 'E')
        finish(start(), 'completed')
        inc = rows('SELECT * FROM incidents')[0]
        self.assertEqual((inc['status'], inc['failure_count']), ('open', 2))
        finish(start(), 'completed')
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'resolved')

    def test_a_bad_upload_in_between_does_not_break_the_streak(self):
        finish(start(), 'failed', 'code_error', 'E')
        finish(start(), 'completed')
        finish(start(), 'failed', 'user_input', 'HTTP 400')
        finish(start(), 'completed')
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'resolved')

    def test_other_tools_successes_do_not_resolve(self):
        finish(start('reach'), 'failed', 'code_error', 'E')
        finish(start('h2h', 'H2H'), 'completed')
        finish(start('h2h', 'H2H'), 'completed')
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'open')

    def test_new_failure_after_resolution_opens_a_new_incident(self):
        finish(start(), 'failed', 'code_error', 'E')
        finish(start(), 'completed'); finish(start(), 'completed')
        finish(start(), 'failed', 'code_error', 'E')
        self.assertEqual([r['status'] for r in rows('SELECT status FROM incidents ORDER BY opened_at')],
                         ['resolved', 'open'])

    def test_acknowledged_incident_still_extends_and_resolves(self):
        finish(start(), 'failed', 'code_error', 'E')
        iid = rows('SELECT id FROM incidents')[0]['id']
        store.patch_incident(iid, {'status': 'acknowledged'})
        finish(start(), 'failed', 'code_error', 'E')
        self.assertEqual(rows('SELECT failure_count FROM incidents')[0]['failure_count'], 2)
        finish(start(), 'completed'); finish(start(), 'completed')
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'resolved')

    def test_excluded_categories_env_changes_what_counts(self):
        os.environ['SLO_EXCLUDED_CATEGORIES'] = 'data_contract'
        try:
            finish(start(), 'failed', 'user_input', 'HTTP 400')
            self.assertEqual(len(rows('SELECT * FROM incidents')), 1)
        finally:
            os.environ.pop('SLO_EXCLUDED_CATEGORIES')


class IncidentPatching(unittest.TestCase):
    def setUp(self):
        reset()
        finish(start(), 'failed', 'code_error', 'E')
        self.iid = rows('SELECT id FROM incidents')[0]['id']

    def err(self, patch, iid=None):
        with self.assertRaises(incidents.IncidentError) as ctx:
            store.patch_incident(iid or self.iid, patch)
        return ctx.exception

    def test_acknowledge(self):
        out = store.patch_incident(self.iid, {'status': 'acknowledged'})
        self.assertEqual(out['status'], 'acknowledged')
        self.assertTrue(out['acknowledged_at'])
        self.assertIsNotNone(out['age_seconds'])
        self.assertIsNone(out['duration_seconds'])
        first = out['acknowledged_at']
        again = store.patch_incident(self.iid, {'status': 'acknowledged'})
        self.assertEqual(again['acknowledged_at'], first)  # idempotent

    def test_resolve_needs_a_resolution(self):
        self.assertEqual(self.err({'status': 'resolved'}).status_code, 422)
        self.assertEqual(self.err({'status': 'resolved', 'resolution': '   '}).status_code, 422)
        self.assertEqual(rows('SELECT status FROM incidents')[0]['status'], 'open')

    def test_resolve_manually(self):
        out = store.patch_incident(self.iid, {'status': 'resolved', 'resolution': 'Fixed the path bug.',
                                              'resolved_by': 'Richard'})
        self.assertEqual((out['status'], out['resolved_by'], out['resolution']),
                         ('resolved', 'Richard', 'Fixed the path bug.'))
        self.assertIsNone(out['age_seconds'])
        self.assertGreaterEqual(out['duration_seconds'], 0)
        # resolved_by defaults to 'manual'
        reset(); finish(start(), 'failed', 'code_error', 'E')
        iid = rows('SELECT id FROM incidents')[0]['id']
        self.assertEqual(store.patch_incident(iid, {'status': 'resolved', 'resolution': 'ok'})['resolved_by'], 'manual')

    def test_resolution_can_arrive_in_an_earlier_patch(self):
        store.patch_incident(self.iid, {'resolution': 'Root cause: H1'})
        out = store.patch_incident(self.iid, {'status': 'resolved'})
        self.assertEqual(out['status'], 'resolved')

    def test_severity_and_runbook(self):
        out = store.patch_incident(self.iid, {'severity': 'sev1', 'runbook': 'job-stuck'})
        self.assertEqual((out['severity'], out['runbook']), ('sev1', 'job-stuck'))
        self.assertEqual(self.err({'severity': 'sev9'}).status_code, 422)

    def test_errors(self):
        self.assertEqual(self.err({'status': 'open'}).status_code, 422)
        self.assertEqual(self.err({'status': 'acknowledged'}, iid='nope').status_code, 404)
        store.patch_incident(self.iid, {'status': 'resolved', 'resolution': 'done'})
        self.assertEqual(self.err({'status': 'acknowledged'}).status_code, 409)

    def test_resolved_twice_keeps_original_timestamp(self):
        first = store.patch_incident(self.iid, {'status': 'resolved', 'resolution': 'done'})
        second = store.patch_incident(self.iid, {'status': 'resolved', 'resolution': 'done, updated note'})
        self.assertEqual(first['resolved_at'], second['resolved_at'])
        self.assertEqual(second['resolution'], 'done, updated note')

    def test_empty_patch_returns_incident_unchanged(self):
        out = store.patch_incident(self.iid, {})
        self.assertEqual(out['status'], 'open')

    def test_listing_filters_and_order(self):
        reset()
        finish(start('reach'), 'failed', 'code_error', 'E')
        finish(start('h2h', 'H2H'), 'failed', 'code_error', 'E')
        h2h_id = rows("SELECT id FROM incidents WHERE tool = 'h2h'")[0]['id']
        store.patch_incident(h2h_id, {'status': 'resolved', 'resolution': 'x'})
        self.assertEqual(len(store.get_incidents('all')), 2)
        self.assertEqual([i['tool'] for i in store.get_incidents('open')], ['reach'])
        self.assertEqual([i['tool'] for i in store.get_incidents('resolved')], ['h2h'])
        self.assertEqual([i['tool'] for i in store.get_incidents('all', tool='h2h')], ['h2h'])
        self.assertEqual(len(store.get_incidents('all', limit=1)), 1)
        self.assertEqual(store.get_incidents('all')[0]['tool'], 'h2h')  # newest first


class Stats(unittest.TestCase):
    NOW = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)

    def setUp(self):
        reset()

    def day(self, n, hour=9):
        return datetime(2026, 10, 30, hour, 0, tzinfo=UTC) - timedelta(days=n)

    def compute(self, **kw):
        with store.connect() as conn:
            return stats.compute_stats(conn, now=self.NOW, **kw)

    def test_empty_window(self):
        out = self.compute(window='7d')
        self.assertEqual(out['overall']['total'], 0)
        self.assertIsNone(out['overall']['success_rate'])
        self.assertIsNone(out['overall']['p95_ms'])
        self.assertIsNone(out['overall']['mttr_seconds'])
        self.assertEqual(len(out['daily']), 7)
        self.assertEqual(out['by_tool'], [])
        self.assertEqual(out['target'], {'success_rate': 0.95})
        self.assertEqual(out['window']['days'], 7)
        self.assertEqual(out['window']['from'], '2026-10-24T00:00:00+00:00')

    def test_rates_counted_vs_excluded(self):
        for i in range(8):
            add_job(status='completed', started=self.day(1, 8 + i % 3), duration=1000 * (i + 1))
        add_job(status='failed', category='code_error', started=self.day(1), error_type='ValueError', tb='h1')
        add_job(status='failed', category='user_input', started=self.day(2))
        add_job(status='failed', category='data_contract', started=self.day(2))
        o = self.compute(window='30d')['overall']
        self.assertEqual((o['total'], o['completed'], o['failed_counted'], o['failed_excluded']), (11, 8, 1, 2))
        self.assertAlmostEqual(o['success_rate'], 8 / 9, places=5)  # excluded failures don't count
        # percentiles of completed durations 1000..8000 (nearest rank)
        self.assertEqual(o['p50_ms'], 4000)
        self.assertEqual(o['p95_ms'], 8000)

    def test_window_boundary_and_active_jobs(self):
        add_job(status='completed', started=self.day(6))      # inside 7d (oldest included day)
        add_job(status='completed', started=self.day(7))      # outside 7d
        with store.connect() as conn:                         # an active job is not counted
            conn.execute("INSERT INTO jobs (id,tool,label,method,path,status,started_at) "
                         "VALUES ('act','reach','REACH','POST','/x','active',?)", (self.day(0).isoformat(),))
        self.assertEqual(self.compute(window='7d')['overall']['total'], 1)
        self.assertEqual(self.compute(window='30d')['overall']['total'], 2)

    def test_canary_excluded_unless_asked(self):
        add_job(status='completed', started=self.day(1))
        add_job(status='failed', category='code_error', started=self.day(1), source='canary')
        self.assertEqual(self.compute()['overall']['failed_counted'], 0)
        self.assertEqual(self.compute(include_canary=True)['overall']['failed_counted'], 1)

    def test_tool_filter(self):
        add_job('reach', started=self.day(1)); add_job('h2h', started=self.day(1), label='H2H')
        out = self.compute(tool='h2h')
        self.assertEqual([t['tool'] for t in out['by_tool']], ['h2h'])
        self.assertEqual(out['overall']['total'], 1)

    def test_by_tool_sorted_by_counted_failures_then_volume(self):
        add_job('a', started=self.day(1), label='A'); add_job('a', started=self.day(1), label='A')
        add_job('b', 'failed', 'code_error', self.day(1), label='B')
        add_job('c', 'failed', 'code_error', self.day(1), label='C')
        add_job('c', 'failed', 'resource', self.day(1), label='C')
        add_job('d', 'failed', 'user_input', self.day(1), label='D')
        order = [t['tool'] for t in self.compute()['by_tool']]
        self.assertEqual(order, ['c', 'b', 'a', 'd'])
        c = self.compute()['by_tool'][0]
        self.assertEqual((c['failed_counted'], c['success_rate'], c['label']), (2, 0.0, 'C'))
        d = [t for t in self.compute()['by_tool'] if t['tool'] == 'd'][0]
        self.assertIsNone(d['success_rate'])  # only excluded failures -> no counted jobs
        self.assertIsNone(d['last_failure_at'])

    def test_by_category(self):
        add_job(status='failed', category='code_error', started=self.day(1))
        add_job(status='failed', category='code_error', started=self.day(1))
        add_job(status='failed', category='user_input', started=self.day(1))
        cats = self.compute()['by_category']
        self.assertEqual(cats, [{'category': 'code_error', 'count': 2, 'counted': True},
                                {'category': 'user_input', 'count': 1, 'counted': False}])

    def test_daily_series_includes_empty_days_in_order(self):
        add_job(status='completed', started=self.day(0)); add_job(status='completed', started=self.day(0))
        add_job(status='failed', category='code_error', started=self.day(2))
        out = self.compute(window='7d')['daily']
        self.assertEqual([d['date'] for d in out],
                         ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28',
                          '2026-10-29', '2026-10-30'])
        by_date = {d['date']: d for d in out}
        self.assertEqual(by_date['2026-10-30']['completed'], 2)
        self.assertEqual(by_date['2026-10-30']['success_rate'], 1.0)
        self.assertEqual(by_date['2026-10-28']['failed_counted'], 1)
        self.assertEqual(by_date['2026-10-28']['success_rate'], 0.0)
        self.assertIsNone(by_date['2026-10-26']['success_rate'])
        self.assertEqual(by_date['2026-10-26']['completed'], 0)

    def test_top_causes(self):
        for _ in range(3):
            add_job('gts_device_tracking', 'failed', 'code_error', self.day(1), error_type='ValueError', tb='hashA',
                    detail='ValueError: stat: path too long\n  at x.py:1 in f')
        add_job('reach', 'failed', 'code_error', self.day(0), error_type='KeyError', tb='hashB', detail='KeyError: lat')
        add_job('reach', 'failed', 'resource', self.day(0), error_type='MemoryError', tb='hashC', detail='MemoryError')
        add_job('reach', 'failed', 'code_error', self.day(3), error_type='HTTP 500', tb=None, detail=None)
        add_job('reach', 'failed', 'user_input', self.day(0), tb='hashD')  # excluded: never a "cause"
        causes = self.compute()['top_causes']
        self.assertEqual(causes[0]['traceback_hash'], 'hashA')
        self.assertEqual((causes[0]['count'], causes[0]['tool'], causes[0]['error_type']),
                         (3, 'gts_device_tracking', 'ValueError'))
        self.assertEqual(causes[0]['sample'], 'ValueError: stat: path too long')
        self.assertNotIn('hashD', [c['traceback_hash'] for c in causes])
        # ties on count: most recently seen first (days 0 before day 3)
        self.assertEqual(causes[-1]['traceback_hash'], None)
        self.assertEqual({c['traceback_hash'] for c in causes[1:3]}, {'hashB', 'hashC'})
        self.assertEqual(len(causes), 4)  # A, B, C and the hash-less HTTP 500 group
        # no stored detail -> falls back to the short error text
        self.assertEqual([c for c in causes if c['traceback_hash'] is None][0]['sample'], 'err')

    def test_top_causes_limited_to_ten(self):
        for i in range(15):
            add_job('reach', 'failed', 'code_error', self.day(1), error_type='E', tb=f'h{i}')
        self.assertEqual(len(self.compute()['top_causes']), 10)

    def test_mttr_and_incident_counts(self):
        def incident(tool, opened_h_ago, resolved_after_min=None):
            opened = self.NOW - timedelta(hours=opened_h_ago)
            resolved = opened + timedelta(minutes=resolved_after_min) if resolved_after_min else None
            with store.connect() as conn:
                conn.execute(
                    'INSERT INTO incidents (id, tool, title, status, opened_at, resolved_at, failure_count) '
                    'VALUES (?,?,?,?,?,?,1)',
                    (os.urandom(4).hex(), tool, 't', 'resolved' if resolved else 'open',
                     opened.isoformat(), resolved.isoformat() if resolved else None))
        for minutes in (10, 20, 30, 40, 100):
            incident('reach', 5, minutes)
        incident('h2h', 2)  # still open
        incident('reach', 24 * 40, 50)  # resolved 40 days ago -> outside 30d window
        o = self.compute(window='30d')['overall']
        self.assertEqual(o['resolved_incidents'], 5)
        self.assertEqual(o['mttr_seconds'], 40 * 60)           # mean of 10,20,30,40,100 min = 40
        self.assertEqual(o['mttr_median_seconds'], 30 * 60)
        self.assertEqual(o['mttr_p90_seconds'], 100 * 60)
        self.assertEqual(o['open_incidents'], 1)
        by = self.compute(tool='reach')['overall']
        self.assertEqual(by['open_incidents'], 0)

    def test_open_incident_id_attached_to_tool(self):
        add_job('reach', 'failed', 'code_error', self.day(0))
        finish(start('reach'), 'failed', 'code_error', 'E')
        iid = rows('SELECT id FROM incidents')[0]['id']
        t = [x for x in self.compute()['by_tool'] if x['tool'] == 'reach'][0]
        self.assertEqual(t['open_incident_id'], iid)

    def test_matches_the_frontend_contract_keys(self):
        add_job(started=self.day(0))
        out = self.compute()
        self.assertEqual(set(out), {'window', 'target', 'overall', 'by_tool', 'by_category', 'daily', 'top_causes'})
        self.assertEqual(set(out['window']), {'from', 'to', 'days'})
        self.assertEqual(set(out['overall']), {
            'total', 'completed', 'failed_counted', 'failed_excluded', 'success_rate', 'p50_ms', 'p95_ms',
            'mttr_seconds', 'mttr_median_seconds', 'mttr_p90_seconds', 'resolved_incidents', 'open_incidents'})
        self.assertEqual(set(out['by_tool'][0]), {
            'tool', 'label', 'total', 'completed', 'failed_counted', 'failed_excluded', 'success_rate',
            'p95_ms', 'last_failure_at', 'open_incident_id'})
        self.assertEqual(set(out['daily'][0]), {'date', 'completed', 'failed_counted', 'failed_excluded',
                                                'success_rate'})
        json.dumps(out)  # serialisable

    def test_incident_dict_matches_frontend_contract(self):
        finish(start(), 'failed', 'code_error', 'E')
        inc = store.get_incidents()[0]
        expected = {'id', 'tool', 'title', 'severity', 'status', 'error_category', 'traceback_hash', 'opened_at',
                    'acknowledged_at', 'resolved_at', 'resolved_by', 'resolution', 'runbook', 'failure_count',
                    'age_seconds', 'duration_seconds'}
        self.assertTrue(expected <= set(inc), expected - set(inc))
        json.dumps(inc)

    def test_bad_window_rejected(self):
        with self.assertRaises(ValueError):
            self.compute(window='1y')

    def test_target_from_env(self):
        os.environ['SLO_TARGET'] = '0.9'
        try:
            self.assertEqual(self.compute()['target']['success_rate'], 0.9)
            os.environ['SLO_TARGET'] = 'banana'
            self.assertEqual(self.compute()['target']['success_rate'], 0.95)
        finally:
            os.environ.pop('SLO_TARGET')


class JobListing(unittest.TestCase):
    def setUp(self):
        reset()
        add_job('reach', 'completed')
        add_job('reach', 'failed', 'code_error')
        add_job('h2h', 'failed', 'user_input', label='H2H')
        add_job('reach', 'failed', 'code_error', source='canary')

    def test_filters(self):
        self.assertEqual(len(store.get_recent(50)), 4)
        self.assertEqual(len(store.get_recent(50, status='failed')), 3)
        self.assertEqual(len(store.get_recent(50, tool='h2h')), 1)
        self.assertEqual(len(store.get_recent(50, category='code_error')), 2)
        self.assertEqual(len(store.get_recent(50, source='canary')), 1)
        self.assertEqual(len(store.get_recent(50, status='failed', source='user', category='code_error')), 1)
        self.assertEqual(len(store.get_recent(2)), 2)

    def test_rows_keep_old_fields_and_add_new_ones(self):
        row = store.get_recent(1)[0]
        for key in ('id', 'tool', 'label', 'method', 'path', 'status', 'status_code', 'started_at', 'ended_at',
                    'duration_ms', 'error', 'error_category', 'error_type', 'error_detail', 'traceback_hash',
                    'stage', 'source', 'input_bytes'):
            self.assertIn(key, row)

    def test_summary_unchanged(self):
        self.assertEqual(store.get_summary(), {'active': 0, 'completed': 1, 'failed': 3, 'total': 4})


class Health(unittest.TestCase):
    def test_liveness(self):
        self.assertEqual(health.liveness(), {'status': 'ok'})

    def patch_checks(self, **results):
        saved = list(health._CHECKS)
        health._CHECKS[:] = [
            (name, critical, results.get(name, lambda: (True, 'fine')))
            for name, critical, _ in saved
        ]
        self.addCleanup(lambda: health._CHECKS.__setitem__(slice(None), saved))

    def test_ready(self):
        self.patch_checks()
        report, code = health.readiness()
        self.assertEqual((report['status'], code), ('ready', 200))
        self.assertEqual([c['name'] for c in report['checks']],
                         ['jobs_db', 'logs_dir_writable', 'disk_free', 'postgis', 'reference_data'])
        self.assertEqual({c['name']: c['critical'] for c in report['checks']},
                         {'jobs_db': True, 'logs_dir_writable': True, 'disk_free': True,
                          'postgis': False, 'reference_data': False})
        for c in report['checks']:
            self.assertEqual(set(c), {'name', 'ok', 'critical', 'ms', 'detail'})
        self.assertGreaterEqual(report['uptime_seconds'], 0)

    def test_noncritical_failure_is_degraded_but_200(self):
        def down():
            raise ConnectionRefusedError('connection refused')
        self.patch_checks(postgis=down)
        report, code = health.readiness()
        self.assertEqual((report['status'], code), ('degraded', 200))
        pg = [c for c in report['checks'] if c['name'] == 'postgis'][0]
        self.assertFalse(pg['ok'])
        self.assertIn('ConnectionRefusedError', pg['detail'])

    def test_critical_failure_is_503(self):
        self.patch_checks(disk_free=lambda: (False, '0.4 GB free (minimum 2 GB)'))
        report, code = health.readiness()
        self.assertEqual((report['status'], code), ('not_ready', 503))

    def test_error_details_hide_passwords(self):
        def leak():
            raise RuntimeError('could not connect: user=u password=hunter2 host=db\nsecond line')
        self.patch_checks(postgis=leak)
        detail = [c for c in health.readiness()[0]['checks'] if c['name'] == 'postgis'][0]['detail']
        self.assertNotIn('hunter2', detail)
        self.assertNotIn('second line', detail)

    def test_real_local_checks(self):
        # the three that don't need Postgres, against the real code
        health._LOGS_DIR = os.path.join(TMP, 'logs')
        self.assertTrue(health._check_jobs_db()[0])
        self.assertTrue(health._check_logs_dir()[0])
        ok, detail = health._check_disk_free()
        self.assertTrue(ok)
        os.environ['MIN_FREE_DISK_GB'] = '99999999'
        try:
            self.assertFalse(health._check_disk_free()[0])
        finally:
            os.environ.pop('MIN_FREE_DISK_GB')

    def test_reference_data_check(self):
        fake = types.ModuleType('toolbox.configs')
        fake.CONFIG = {'DATASETS': {'settlements': 'x', 'wards': 'y'}}
        sys.modules['toolbox.configs'] = fake
        try:
            self.assertEqual(health._check_reference_data()[0], True)
            fake.CONFIG = {'DATASETS': {}}
            self.assertFalse(health._check_reference_data()[0])
        finally:
            del sys.modules['toolbox.configs']

    def test_postgis_check_without_credentials_fails_cleanly(self):
        for k in ('PASSWORD', 'HOST', 'PORT', 'DB', 'USER'):
            os.environ.pop(k, None)
        os.environ['PASSWORD'] = ''  # keep dotenv from complaining; HOST etc. missing
        try:
            report_check = health._run('postgis', False, health._check_postgis)
        finally:
            os.environ.pop('PASSWORD', None)
        self.assertFalse(report_check['ok'])
        self.assertTrue(report_check['detail'])



class RouterFunctions(unittest.TestCase):
    """Calls the route functions directly (FastAPI itself is not installable in the sandbox)."""

    def setUp(self):
        reset()
        import importlib
        self.r = importlib.import_module('toolbox.job_tracker.router')  # the module, not the package's `router` attribute

    def test_route_table(self):
        table = {(m, p) for m, p, _, _ in self.r.router.routes}
        self.assertEqual(table, {
            ('GET', '/jobs/summary'), ('GET', '/jobs/stats'), ('GET', '/jobs'), ('GET', '/incidents'),
            ('PATCH', '/incidents/{incident_id}'), ('GET', '/health'), ('GET', '/ready'),
            ('GET', '/jobs/{job_id}/logs'), ('GET', '/upload-limit')})
        from toolbox.job_tracker.middleware import TOOL_ENDPOINTS
        tracked_paths = {path for (_, path) in TOOL_ENDPOINTS}
        for _, path in table:
            self.assertNotIn(path, tracked_paths)

    def test_stats_and_jobs(self):
        add_job(started=datetime.now(UTC))
        out = self.r.jobs_stats(window='7d', tool=None, include_canary=False)
        self.assertEqual(out['overall']['completed'], 1)
        self.assertEqual(len(self.r.jobs_recent(limit=5, status='completed', tool=None, category=None,
                                                source=None)['jobs']), 1)

    def test_incident_routes(self):
        from fastapi import HTTPException
        finish(start(), 'failed', 'code_error', 'E')
        listed = self.r.incidents_list(status='open', tool=None, limit=50)['incidents']
        self.assertEqual(len(listed), 1)
        iid = listed[0]['id']
        body = self.r.IncidentPatchBody
        with self.assertRaises(HTTPException) as ctx:
            self.r.incidents_patch(iid, body(status='resolved'))
        self.assertEqual(ctx.exception.status_code, 422)
        with self.assertRaises(HTTPException) as ctx:
            self.r.incidents_patch('missing', body(status='acknowledged'))
        self.assertEqual(ctx.exception.status_code, 404)
        out = self.r.incidents_patch(iid, body(status='resolved', resolution='fixed'))
        self.assertEqual(out['status'], 'resolved')
        # only the fields the client sent are applied
        self.assertEqual(body(severity='sev2').model_dump(exclude_unset=True), {'severity': 'sev2'})

    def test_health_and_ready(self):
        self.assertEqual(asyncio.run(self.r.health_check()), {'status': 'ok'})
        saved = list(health._CHECKS)
        try:
            health._CHECKS[:] = [(n, c, (lambda: (True, 'ok'))) for n, c, _ in saved]
            resp = self.r.ready_check()
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(json.loads(resp.body)['status'], 'ready')
            health._CHECKS[0] = (saved[0][0], True, lambda: (False, 'broken'))
            resp = self.r.ready_check()
            self.assertEqual(resp.status_code, 503)
            self.assertEqual(json.loads(resp.body)['status'], 'not_ready')
        finally:
            health._CHECKS[:] = saved

if __name__ == '__main__':
    unittest.main()
