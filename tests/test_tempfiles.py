"""Tests for toolbox/utils/tempfiles.py (result files deleted after they are sent).

Run from the repo root:  python -m unittest tests.test_tempfiles -v
"""
import asyncio
import os
import shutil
import tempfile
import time
import unittest
from unittest import mock

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from toolbox.utils import tempfiles


class TempFilesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='tf-test-')
        patcher = mock.patch.object(tempfiles, 'RESULT_DIR', os.path.join(self.dir, 'results'))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        os.environ.pop('TEMP_FILE_MAX_AGE_HOURS', None)

    def age(self, path, seconds):
        old = time.time() - seconds
        os.utime(path, (old, old))

    def test_new_file_is_in_result_dir_with_suffix(self):
        path = tempfiles.new_result_file('.csv')
        self.assertTrue(os.path.isfile(path))
        self.assertEqual(os.path.dirname(path), tempfiles.RESULT_DIR)
        self.assertTrue(path.endswith('.csv'))

    def test_two_files_do_not_collide(self):
        self.assertNotEqual(tempfiles.new_result_file(), tempfiles.new_result_file())

    def test_remove_file_deletes_and_tolerates_missing(self):
        path = tempfiles.new_result_file()
        tempfiles.remove_file(path)
        self.assertFalse(os.path.exists(path))
        tempfiles.remove_file(path)  # second call must not raise

    def test_remove_file_logs_other_errors_instead_of_raising(self):
        with mock.patch.object(tempfiles.os, 'remove', side_effect=PermissionError('locked')):
            with self.assertLogs(tempfiles._log, level='WARNING'):
                tempfiles.remove_file('whatever.csv')

    def test_delete_after_response_runs_the_delete(self):
        path = tempfiles.new_result_file()
        task = tempfiles.delete_after_response(path)
        self.assertTrue(os.path.exists(path))
        asyncio.run(task())
        self.assertFalse(os.path.exists(path))

    def test_file_response_background_deletes_after_send(self):
        from starlette.responses import FileResponse
        path = tempfiles.new_result_file()
        with open(path, 'w') as fh:
            fh.write('a,b\n1,2\n')
        sent = []

        async def receive():
            return {'type': 'http.request'}

        async def send(message):
            sent.append(message)
            if message['type'] == 'http.response.body' and not message.get('more_body'):
                self.assertTrue(os.path.exists(path))  # still there while sending

        response = FileResponse(path, media_type='text/csv', background=tempfiles.delete_after_response(path))
        scope = {'type': 'http', 'method': 'GET', 'headers': [], 'extensions': {}}
        asyncio.run(response(scope, receive, send))
        self.assertTrue(any(m['type'] == 'http.response.body' for m in sent))
        self.assertFalse(os.path.exists(path))

    def serve(self, response):
        sent = []

        async def receive():
            return {'type': 'http.request'}

        async def send(message):
            sent.append(message)

        scope = {'type': 'http', 'method': 'GET', 'headers': [], 'extensions': {}}
        asyncio.run(response(scope, receive, send))
        return sent

    def test_file_response_writes_serves_then_deletes(self):
        seen = {}

        def write(path):
            seen['path'] = path
            with open(path, 'w') as fh:
                fh.write('a,b\n1,2\n')

        response = tempfiles.file_response(write, '.csv', 'text/csv', 'my result.csv')
        path = seen['path']
        self.assertEqual(os.path.dirname(path), tempfiles.RESULT_DIR)
        self.assertTrue(path.endswith('.csv'))
        self.assertTrue(os.path.exists(path), 'must exist until it has been sent')
        self.assertEqual(response.media_type, 'text/csv')
        self.assertIn('my%20result.csv', response.headers['content-disposition'])
        sent = self.serve(response)
        body = b''.join(m.get('body', b'') for m in sent if m['type'] == 'http.response.body')
        self.assertEqual(body, b'a,b\n1,2\n')
        self.assertFalse(os.path.exists(path), 'deleted after the response was sent')

    def test_file_response_removes_a_half_written_file_when_the_write_fails(self):
        seen = {}

        def write(path):
            seen['path'] = path
            with open(path, 'w') as fh:
                fh.write('partial')
            raise ValueError('cannot serialise')

        with self.assertRaises(ValueError):
            tempfiles.file_response(write, '.csv', 'text/csv', 'x.csv')
        self.assertFalse(os.path.exists(seen['path']))
        self.assertEqual(os.listdir(tempfiles.RESULT_DIR), [])

    def test_file_response_removes_the_file_even_for_a_cancelled_request(self):
        seen = {}

        def write(path):
            seen['path'] = path
            raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            tempfiles.file_response(write, '.png', 'image/png', 'x.png')
        self.assertFalse(os.path.exists(seen['path']))

    def test_file_response_works_with_a_real_dataframe_and_workbook_writer(self):
        import pandas as pd
        frame = pd.DataFrame({'a': [1, 2], 'b': ['x', 'y']})

        def write(path):
            with pd.ExcelWriter(path, engine='openpyxl') as writer:
                frame.to_excel(writer, sheet_name='One', index=False)

        response = tempfiles.file_response(write, '.xlsx', 'application/vnd.ms-excel', 'out.xlsx')
        again = pd.read_excel(response.path, sheet_name='One')
        self.assertEqual(again['a'].tolist(), [1, 2])
        self.serve(response)
        self.assertFalse(os.path.exists(response.path))

        csv_response = tempfiles.file_response(lambda p: frame.to_csv(p, index=False), '.csv', 'text/csv', 'o.csv')
        self.assertEqual(pd.read_csv(csv_response.path).shape, (2, 2))
        self.serve(csv_response)

    def test_afile_response_writes_in_a_worker_thread_and_keeps_the_loop_free(self):
        import threading
        from tests.test_offload import worst_stall, SLOW, MAX_STALL
        seen = {}

        def write(path):
            seen['thread'] = threading.current_thread()
            time.sleep(SLOW)
            with open(path, 'w') as fh:
                fh.write('a\n1\n')

        async def scenario():
            return await worst_stall(lambda: tempfiles.afile_response(write, '.csv', 'text/csv', 'out.csv'))

        (response, stall) = asyncio.run(scenario())
        self.assertIsNot(seen['thread'], threading.main_thread())
        self.assertLess(stall, MAX_STALL)
        self.assertEqual(open(response.path).read(), 'a\n1\n')
        self.serve(response)
        self.assertFalse(os.path.exists(response.path))

    def test_afile_response_removes_the_file_when_the_write_fails(self):
        seen = {}

        def write(path):
            seen['path'] = path
            raise ValueError('cannot serialise')

        with self.assertRaises(ValueError):
            asyncio.run(tempfiles.afile_response(write, '.csv', 'text/csv', 'x.csv'))
        self.assertFalse(os.path.exists(seen['path']))
        self.assertEqual(os.listdir(tempfiles.RESULT_DIR), [])

    def test_afile_response_sets_type_and_download_name(self):
        response = asyncio.run(tempfiles.afile_response(lambda p: open(p, 'w').close(), '.xlsx', 'application/x-test', 'book.xlsx'))
        self.assertEqual(response.media_type, 'application/x-test')
        self.assertIn('book.xlsx', response.headers['content-disposition'])
        self.serve(response)

    def test_sweep_removes_only_stale_files(self):
        old = tempfiles.new_result_file()
        fresh = tempfiles.new_result_file()
        self.age(old, 7 * 3600)
        self.assertEqual(tempfiles.sweep_stale(), 1)
        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(fresh))

    def test_new_result_file_sweeps_stale_files(self):
        old = tempfiles.new_result_file()
        self.age(old, 7 * 3600)
        tempfiles.new_result_file()
        self.assertFalse(os.path.exists(old))

    def test_age_limit_comes_from_env(self):
        path = tempfiles.new_result_file()
        self.age(path, 2 * 3600)
        self.assertEqual(tempfiles.sweep_stale(), 0)
        os.environ['TEMP_FILE_MAX_AGE_HOURS'] = '1'
        self.assertEqual(tempfiles.sweep_stale(), 1)

    def test_bad_env_value_falls_back_to_default(self):
        os.environ['TEMP_FILE_MAX_AGE_HOURS'] = 'abc'
        self.assertEqual(tempfiles._max_age_seconds(), tempfiles.DEFAULT_MAX_AGE_HOURS * 3600)

    def test_sweep_with_missing_dir_is_a_noop(self):
        self.assertEqual(tempfiles.sweep_stale(), 0)

    def test_sweep_ignores_subfolders(self):
        tempfiles.new_result_file()
        sub = os.path.join(tempfiles.RESULT_DIR, 'keep')
        os.makedirs(sub)
        self.age(sub, 99 * 3600)
        tempfiles.sweep_stale()
        self.assertTrue(os.path.isdir(sub))


if __name__ == '__main__':
    unittest.main()
