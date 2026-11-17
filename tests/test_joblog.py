"""Tests for the live job logs (job_tracker/joblog.py, the GET /jobs/{id}/logs route,
and the X-Client-Job-Id handling in the middleware).

Run from /home/claude/work:  python3 -m unittest tests.test_joblog -v
"""
import asyncio
import concurrent.futures
import contextvars
import importlib
import logging
import time
import unittest
import uuid
from unittest import mock

from tests import test_reliability as base  # throwaway DB + package imports
from tests.test_reliability import asgi_call, latest_job, make_app, rows, store
from starlette.responses import PlainTextResponse

from toolbox.errors import DataContractError
from toolbox.job_tracker import joblog
from toolbox.job_tracker.context import current_client_job_id
from toolbox.job_tracker.middleware import _failure_line

router_module = importlib.import_module('toolbox.job_tracker.router')
HEADER = 'X-Client-Job-Id'


def new_id():
    return str(uuid.uuid4())


def setUpModule():
    logging.getLogger().setLevel(logging.INFO)
    joblog.install_log_handler()


class Buffer(unittest.TestCase):
    def setUp(self):
        joblog.reset()

    def test_ids_must_be_uuids(self):
        for bad in ('', 'abc', '123', 'x' * 36, '../../etc/passwd', None):
            self.assertFalse(joblog.register(bad), bad)
        self.assertTrue(joblog.register(new_id()))
        self.assertTrue(joblog.valid_id(new_id().upper()))

    def test_an_id_cannot_be_registered_twice(self):
        job = new_id()
        self.assertTrue(joblog.register(job))
        self.assertFalse(joblog.register(job))

    def test_lines_are_numbered_from_one_and_read_after_a_cursor(self):
        job = new_id()
        joblog.register(job)
        for n in range(5):
            joblog.append(job, 'INFO', f'line {n}')
        everything = joblog.read(job, 0)
        self.assertEqual([l['seq'] for l in everything['lines']], [1, 2, 3, 4, 5])
        self.assertEqual(everything['next'], 5)
        self.assertFalse(everything['truncated'])
        newer = joblog.read(job, 3)
        self.assertEqual([l['message'] for l in newer['lines']], ['line 3', 'line 4'])
        caught_up = joblog.read(job, 5)
        self.assertEqual((caught_up['lines'], caught_up['next']), ([], 5))
        self.assertEqual({'seq', 'ts', 'level', 'message'}, set(everything['lines'][0]))

    def test_limit_pages_through_the_lines(self):
        job = new_id()
        joblog.register(job)
        for n in range(10):
            joblog.append(job, 'INFO', str(n))
        first = joblog.read(job, 0, limit=4)
        self.assertEqual((len(first['lines']), first['next']), (4, 4))
        second = joblog.read(job, first['next'], limit=4)
        self.assertEqual([l['seq'] for l in second['lines']], [5, 6, 7, 8])

    def test_unknown_id_reads_as_none_and_appends_are_ignored(self):
        self.assertIsNone(joblog.read(new_id()))
        joblog.append(new_id(), 'INFO', 'nobody is listening')   # must not raise

    def test_old_lines_are_dropped_and_reported_as_truncated(self):
        with mock.patch.object(joblog, 'MAX_LINES', 3):
            job = new_id()
            joblog.register(job)
            for n in range(1, 8):
                joblog.append(job, 'INFO', str(n))
        got = joblog.read(job, 0)
        self.assertEqual([l['message'] for l in got['lines']], ['5', '6', '7'])
        self.assertTrue(got['truncated'])
        self.assertFalse(joblog.read(job, 4)['truncated'])    # the caller already has 1-4

    def test_long_lines_are_cut(self):
        job = new_id()
        joblog.register(job)
        joblog.append(job, 'INFO', 'x' * 5000)
        self.assertEqual(len(joblog.read(job)['lines'][0]['message']), joblog.MAX_LINE_CHARS)

    def test_the_oldest_finished_job_is_evicted_first(self):
        with mock.patch.object(joblog, 'MAX_JOBS', 2):
            a, b, c = new_id(), new_id(), new_id()
            joblog.register(a)
            joblog.register(b)
            joblog.mark_finished(b)
            joblog.register(c)
        self.assertIsNotNone(joblog.read(a))     # still running, kept
        self.assertIsNone(joblog.read(b))        # finished, evicted
        self.assertIsNotNone(joblog.read(c))

    def test_when_all_are_running_the_oldest_goes(self):
        with mock.patch.object(joblog, 'MAX_JOBS', 2):
            a, b, c = new_id(), new_id(), new_id()
            for job in (a, b, c):
                joblog.register(job)
        self.assertIsNone(joblog.read(a))
        self.assertIsNotNone(joblog.read(c))

    def test_a_finished_job_expires_after_the_retention_time(self):
        job, other = new_id(), new_id()
        joblog.register(job)
        joblog.register(other)
        joblog.mark_finished(job)
        with mock.patch.object(joblog, 'RETENTION_SECONDS', 60), mock.patch.object(time, 'time', return_value=time.time() + 120):
            self.assertIsNone(joblog.read(job))
            self.assertIsNotNone(joblog.read(other))   # running jobs never expire

    def test_negative_cursor_is_treated_as_zero(self):
        job = new_id()
        joblog.register(job)
        joblog.append(job, 'INFO', 'a')
        self.assertEqual(len(joblog.read(job, -5)['lines']), 1)


class Handler(unittest.TestCase):
    def setUp(self):
        joblog.reset()
        self.job = new_id()
        joblog.register(self.job)
        self.log = logging.getLogger('joblog.test')
        self.log.setLevel(logging.INFO)

    def lines(self):
        return [(l['level'], l['message']) for l in joblog.read(self.job)['lines']]

    def test_records_in_the_job_context_are_captured_with_their_level(self):
        token = current_client_job_id.set(self.job)
        try:
            self.log.info('reading tracks')
            self.log.warning('slow file %s', 'x.csv')
            self.log.error('bad row')
        finally:
            current_client_job_id.reset(token)
        self.assertEqual(self.lines(), [('INFO', 'reading tracks'), ('WARNING', 'slow file x.csv'), ('ERROR', 'bad row')])

    def test_records_outside_a_job_are_ignored(self):
        self.log.info('background chatter')
        self.assertEqual(self.lines(), [])

    def test_the_job_stamp_is_removed(self):
        token = current_client_job_id.set(self.job)
        try:
            self.log.info('[job=abcd1234] stamped by the file logger')
        finally:
            current_client_job_id.reset(token)
        self.assertEqual(self.lines(), [('INFO', 'stamped by the file logger')])

    def test_an_exception_is_summarised_on_the_line(self):
        token = current_client_job_id.set(self.job)
        try:
            try:
                raise KeyError('Team Code')
            except KeyError:
                self.log.exception('analysis failed')
        finally:
            current_client_job_id.reset(token)
        self.assertEqual(self.lines(), [('ERROR', "analysis failed [KeyError: 'Team Code']")])

    def test_debug_records_below_the_logger_level_are_not_captured(self):
        token = current_client_job_id.set(self.job)
        try:
            self.log.debug('too chatty')
        finally:
            current_client_job_id.reset(token)
        self.assertEqual(self.lines(), [])

    def test_worker_threads_only_count_when_the_context_is_carried_over(self):
        token = current_client_job_id.set(self.job)
        try:
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                pool.submit(self.log.info, 'plain executor').result()                       # no context: lost
                pool.submit(contextvars.copy_context().run, self.log.info, 'with context').result()
        finally:
            current_client_job_id.reset(token)
        self.assertEqual(self.lines(), [('INFO', 'with context')])

    def test_installing_twice_adds_one_handler(self):
        joblog.install_log_handler()
        joblog.install_log_handler()
        self.assertEqual(sum(isinstance(h, joblog.JobLogHandler) for h in logging.getLogger().handlers), 1)


class FailureLine(unittest.TestCase):
    def test_shapes(self):
        contract = '{"error":{"code":"missing_columns","message":"The tracks file is missing \\"Team Code\\".","details":{}}}'
        self.assertEqual(_failure_line(422, contract), 'Failed (HTTP 422): The tracks file is missing "Team Code".')
        self.assertEqual(_failure_line(500, '{"msg":"Invalid Input","detail":"No extension","status_code":500}'),
                         'Failed (HTTP 500): Invalid Input: No extension')
        self.assertEqual(_failure_line(500, '{"msg":"Boom"}'), 'Failed (HTTP 500): Boom')
        self.assertEqual(_failure_line(500, 'Internal Server Error'), 'Failed (HTTP 500).')
        self.assertEqual(_failure_line(502, None), 'Failed (HTTP 502).')
        self.assertEqual(_failure_line(400, '{"detail":[{"msg":"x"}]}'), 'Failed (HTTP 400).')

    def test_a_body_cut_off_mid_json_still_yields_the_message(self):
        cut = '{"error":{"code":"missing_columns","message":"Columns are missing.","details":{"tool":"gts_devi'
        self.assertEqual(_failure_line(422, cut), 'Failed (HTTP 422): Columns are missing.')


class Middleware(unittest.TestCase):
    def setUp(self):
        joblog.reset()

    def run_app(self, handler, client_id=None, headers=None):
        hdrs = dict(headers or {})
        if client_id is not None:
            hdrs[HEADER] = client_id
        return asyncio.run(asgi_call(make_app(handler), headers=hdrs))

    def test_a_tool_run_with_the_header_gets_a_live_log(self):
        job = new_id()

        async def handler(request):
            logging.getLogger('tool').info('Reading tracks')
            logging.getLogger('tool').warning('Dropped 3 rows')
            return PlainTextResponse('csv')

        sent, raised = self.run_app(handler, job)
        self.assertIsNone(raised)
        got = joblog.read(job)
        self.assertEqual([(l['level'], l['message']) for l in got['lines']],
                         [('INFO', 'Reading tracks'), ('WARNING', 'Dropped 3 rows'), ('INFO', 'Finished (HTTP 200).')])
        self.assertEqual(rows('SELECT client_job_id FROM jobs WHERE client_job_id = ?', job)[0]['client_job_id'], job)
        self.assertEqual(store.get_status_by_client_id(job), 'completed')

    def test_a_data_check_failure_is_logged_as_an_error_line(self):
        job = new_id()

        async def handler(request):
            raise DataContractError('missing_columns', 'The tracks file is missing required column(s): \'Team Code\'.')

        self.run_app(handler, job)
        got = joblog.read(job)
        self.assertEqual(got['lines'][-1]['level'], 'ERROR')
        self.assertEqual(got['lines'][-1]['message'], "Failed (HTTP 422): The tracks file is missing required column(s): 'Team Code'.")
        self.assertEqual(store.get_status_by_client_id(job), 'failed')

    def test_a_crash_is_logged_and_the_buffer_is_closed(self):
        job = new_id()

        async def handler(request):
            raise ValueError('stat: path too long')

        sent, raised = self.run_app(handler, job)
        self.assertIsInstance(raised, ValueError)
        last = joblog.read(job)['lines'][-1]
        self.assertEqual((last['level'], last['message']), ('ERROR', 'Failed: ValueError: stat: path too long'))
        self.assertEqual(store.get_status_by_client_id(job), 'failed')

    def test_no_header_means_no_log(self):
        async def handler(request):
            logging.getLogger('tool').info('hello')
            return PlainTextResponse('csv')

        self.run_app(handler)
        self.assertIsNone(latest_job()['client_job_id'])
        self.assertEqual(joblog._logs, {})

    def test_an_invalid_id_is_ignored_and_the_request_still_works(self):
        async def handler(request):
            return PlainTextResponse('csv')

        sent, raised = self.run_app(handler, 'not-a-uuid')
        self.assertIsNone(raised)
        self.assertEqual(sent[0]['status'], 200)
        self.assertIsNone(latest_job()['client_job_id'])
        self.assertEqual(joblog._logs, {})

    def test_reusing_an_id_cannot_write_into_the_first_runs_log(self):
        job = new_id()

        async def first(request):
            logging.getLogger('tool').info('first run')
            return PlainTextResponse('csv')

        async def second(request):
            logging.getLogger('tool').info('intruder')
            return PlainTextResponse('csv')

        self.run_app(first, job)
        self.run_app(second, job)
        messages = [l['message'] for l in joblog.read(job)['lines']]
        self.assertEqual(messages, ['first run', 'Finished (HTTP 200).'])
        self.assertIsNone(latest_job()['client_job_id'])      # the second run was not tagged

    def test_concurrent_runs_keep_their_lines_apart(self):
        a, b = new_id(), new_id()

        def handler_for(name):
            async def handler(request):
                for n in range(3):
                    logging.getLogger('tool').info('%s step %d', name, n)
                    await asyncio.sleep(0.01)
                return PlainTextResponse('csv')
            return handler

        async def both():
            await asyncio.gather(
                asgi_call(make_app(handler_for('A')), headers={HEADER: a}),
                asgi_call(make_app(handler_for('B')), headers={HEADER: b}),
            )

        asyncio.run(both())
        for job, name in ((a, 'A'), (b, 'B')):
            mine = [l['message'] for l in joblog.read(job)['lines'] if 'step' in l['message']]
            self.assertEqual(mine, [f'{name} step {n}' for n in range(3)])

    def test_the_log_stays_readable_after_the_run_ends(self):
        job = new_id()

        async def handler(request):
            return PlainTextResponse('csv')

        self.run_app(handler, job)
        self.assertEqual(len(joblog.read(job)['lines']), 1)
        self.assertIsNotNone(joblog._logs[job].finished_at)


class Route(unittest.TestCase):
    def setUp(self):
        joblog.reset()

    def call(self, job_id, after=0, limit=500):
        return router_module.job_logs(job_id, after, limit)

    def test_unknown_id_is_a_normal_answer(self):
        got = self.call(new_id())
        self.assertEqual(got['status'], 'unknown')
        self.assertEqual((got['lines'], got['next'], got['truncated']), ([], 0, False))

    def test_junk_id_is_the_same_answer(self):
        self.assertEqual(self.call('../../x')['status'], 'unknown')

    def test_response_matches_what_the_frontend_expects(self):
        job = new_id()

        async def handler(request):
            logging.getLogger('tool').info('one')
            logging.getLogger('tool').info('two')
            return PlainTextResponse('csv')

        asyncio.run(asgi_call(make_app(handler), headers={HEADER: job}))
        got = self.call(job)
        self.assertEqual(set(got), {'job_id', 'status', 'stage', 'lines', 'next', 'truncated'})
        self.assertEqual((got['job_id'], got['status']), (job, 'completed'))
        self.assertEqual([l['message'] for l in got['lines']], ['one', 'two', 'Finished (HTTP 200).'])
        self.assertEqual(got['next'], 3)
        again = self.call(job, after=got['next'])                    # the next poll gets nothing new
        self.assertEqual((again['lines'], again['next']), ([], 3))
        partial = self.call(job, after=1)
        self.assertEqual([l['message'] for l in partial['lines']], ['two', 'Finished (HTTP 200).'])

    def test_stage_follows_report_stage(self):
        job = new_id()
        joblog.register(job)
        job_row = store.start_job('reach', 'REACH', 'POST', '/validation', None, client_job_id=job)
        self.assertIsNone(self.call(job)['stage'])                   # nothing reported yet
        store.set_stage(job_row, 'Reading settlements')
        self.assertEqual(self.call(job)['stage'], 'Reading settlements')
        store.set_stage(job_row, 'Writing results')
        self.assertEqual(self.call(job)['stage'], 'Writing results')

    def test_unknown_id_has_no_stage(self):
        self.assertIsNone(self.call(new_id())['stage'])

    def test_an_active_job_reports_active(self):
        job = new_id()
        joblog.register(job)
        store.start_job('reach', 'REACH', 'POST', '/validation', None, client_job_id=job)
        self.assertEqual(self.call(job)['status'], 'active')

    def test_status_survives_the_buffer_being_dropped(self):
        job = new_id()
        joblog.register(job)
        store.start_job('reach', 'REACH', 'POST', '/validation', None, client_job_id=job)
        joblog.reset()                                               # e.g. evicted
        got = self.call(job)
        self.assertEqual((got['status'], got['lines']), ('active', []))

    def test_route_does_not_swallow_the_fixed_job_routes(self):
        paths = [r[1] if isinstance(r, tuple) else r.path for r in router_module.router.routes]   # shim stores tuples; real FastAPI stores route objects
        self.assertLess(paths.index('/jobs/summary'), paths.index('/jobs/{job_id}/logs'))
        self.assertLess(paths.index('/jobs/stats'), paths.index('/jobs/{job_id}/logs'))


class Schema(unittest.TestCase):
    def test_column_and_index_exist(self):
        self.assertIn('client_job_id', {r['name'] for r in rows('PRAGMA table_info(jobs)')})
        self.assertIn('idx_jobs_client_job_id', {r['name'] for r in rows("SELECT name FROM sqlite_master WHERE type='index'")})
        self.assertNotIn('client_job_id', store.get_recent(1)[0] if store.get_recent(1) else {})   # not exposed in /jobs


if __name__ == '__main__':
    unittest.main()
