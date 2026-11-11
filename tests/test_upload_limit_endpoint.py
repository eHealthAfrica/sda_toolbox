"""GET /upload-limit: tells the upload forms the largest request the API accepts.

The frontend reads it (when its own check is enabled) so a file over MAX_UPLOAD_MB is refused with the server's own wording before it is
sent (browsers often hide the server's 413 answer when the connection is closed mid-upload).

Run from the repo root:  python -m unittest tests.test_upload_limit_endpoint -v
"""
import asyncio
import os
import unittest
from unittest import mock

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_h7_routes import load_route
from toolbox.utils import upload_limit

MB = 1024 * 1024


def endpoint():
    route = load_route(
        'job_tracker/router.py',
        **{'pydantic': dict(BaseModel=object),
           'toolbox.utils.upload_limit': dict(max_upload_bytes=upload_limit.max_upload_bytes)})
    return route.upload_limit


class TestUploadLimitEndpoint(unittest.TestCase):
    def answer(self, value, enabled='1'):
        env = {} if value is None else {'MAX_UPLOAD_MB': value}
        if enabled is not None:
            env['UPLOAD_LIMIT_ENABLED'] = enabled
        with mock.patch.dict(os.environ, env, clear=False):
            if value is None:
                os.environ.pop('MAX_UPLOAD_MB', None)
            if enabled is None:
                os.environ.pop('UPLOAD_LIMIT_ENABLED', None)
            return asyncio.run(endpoint()())

    def test_off_by_default_is_reported_as_null(self):
        self.assertEqual(self.answer(None, enabled=None), {'max_upload_bytes': None, 'max_upload_mb': None})

    def test_a_leftover_max_upload_mb_is_not_reported_while_off(self):
        self.assertEqual(self.answer('512', enabled=None), {'max_upload_bytes': None, 'max_upload_mb': None})

    def test_reports_the_configured_limit(self):
        self.assertEqual(self.answer('512'), {'max_upload_bytes': 512 * MB, 'max_upload_mb': 512.0})

    def test_default_limit(self):
        self.assertEqual(self.answer(None)['max_upload_bytes'], 200 * MB)

    def test_fractional_limit(self):
        self.assertEqual(self.answer('0.5'), {'max_upload_bytes': MB // 2, 'max_upload_mb': 0.5})

    def test_switched_off_is_reported_as_null(self):
        self.assertEqual(self.answer('0'), {'max_upload_bytes': None, 'max_upload_mb': None})

    def test_it_is_not_logged_as_a_tool_job(self):
        from toolbox.job_tracker.middleware import TOOL_ENDPOINTS
        self.assertNotIn(('GET', '/upload-limit'), TOOL_ENDPOINTS)

    def test_it_matches_what_the_middleware_enforces(self):
        """The number the forms are told is the number the middleware refuses above."""
        with mock.patch.dict(os.environ, {'MAX_UPLOAD_MB': '7', 'UPLOAD_LIMIT_ENABLED': '1'}):
            self.assertEqual(asyncio.run(endpoint()())['max_upload_bytes'], upload_limit.max_upload_bytes())


if __name__ == '__main__':
    unittest.main()
