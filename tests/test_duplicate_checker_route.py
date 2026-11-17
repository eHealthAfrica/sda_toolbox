"""The duplicate checker route: the 'Cross-reference source' toggle must be honoured, and a file with no
'Source' column must get a clear answer instead of "Missing Config Info 'Source'".

Run from the repo root:  python -m unittest tests.test_duplicate_checker_route -v
The route is loaded straight from its file with stand-ins for the web framework and the toolbox
packages; pandas is real.
"""
import asyncio
import unittest

import pandas as pd

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_h7_readers import load, stand_in
from toolbox.utils import offload


class DataContractError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


class Recorder:
    def __init__(self):
        self.search_args = None
        self.dataset = None


def build(frame):
    rec = Recorder()

    async def read_dataset(_file):
        return frame.copy()

    def search(dataset, unique_col, threshold, geom, output, cross_reference):
        rec.search_args = (unique_col, threshold, geom, output, cross_reference)
        rec.dataset = dataset
        return dataset

    async def afile_response(writer, suffix, media_type, name):
        return ('response', suffix, name)

    class Router:
        def post(self, *_a, **_k):
            return lambda fn: fn

    stubs = {
        'fastapi': stand_in('fastapi', APIRouter=Router, UploadFile=object),
        'fastapi.responses': stand_in('fastapi.responses', FileResponse=object),
        'toolbox.errors': stand_in('toolbox.errors', DataContractError=DataContractError),
        'toolbox.spatial_mgr': stand_in('toolbox.spatial_mgr', GeomColumns=type('G', (), {'get_geom_cols': staticmethod(lambda d, f: ['lat', 'lon'])})),
        'toolbox.access.read_mgr': stand_in('toolbox.access.read_mgr', read_dataset=read_dataset),
        'toolbox.mlos': stand_in('toolbox.mlos', detect_unique_admin_field=lambda d: 'unique_code', construct_new_unique=lambda d, c: d),
        'toolbox.mlos.validation.review': stand_in('toolbox.mlos.validation.review', duplicate_deep_search_protocol=search),
        'toolbox.utils.tempfiles': stand_in('toolbox.utils.tempfiles', afile_response=afile_response),
        'toolbox.utils.offload': offload,
    }
    return load('apps/mlos/duplicate_checker.py', stubs), rec


def call(frame, cross):
    route, rec = build(frame)
    result = asyncio.run(route.search_for_duplicate_settlements(object(), 80, cross))
    return result, rec


class TestCrossReferenceToggle(unittest.TestCase):
    def test_toggle_on_is_passed_to_the_search(self):
        _, rec = call(pd.DataFrame({'Name': ['a'], 'Source': ['x']}), True)
        self.assertIs(rec.search_args[-1], True)

    def test_toggle_off_is_passed_to_the_search(self):
        _, rec = call(pd.DataFrame({'Name': ['a']}), False)
        self.assertIs(rec.search_args[-1], False)

    def test_toggle_off_does_not_need_a_source_column(self):
        result, _ = call(pd.DataFrame({'Name': ['a']}), False)
        self.assertEqual(result[0], 'response')


class TestSourceColumn(unittest.TestCase):
    def test_exact_column_is_left_alone(self):
        _, rec = call(pd.DataFrame({'Name': ['a'], 'Source': ['x']}), True)
        self.assertEqual(list(rec.dataset.columns), ['Name', 'Source'])

    def test_differently_spelled_column_is_renamed(self):
        for spelling in ('source', 'SOURCE', ' Source '):
            with self.subTest(spelling=spelling):
                _, rec = call(pd.DataFrame({'Name': ['a'], spelling: ['x']}), True)
                self.assertEqual(list(rec.dataset.columns), ['Name', 'Source'])
                self.assertEqual(rec.dataset['Source'].tolist(), ['x'])

    def test_missing_column_gives_a_clear_data_error_and_skips_the_search(self):
        route, rec = build(pd.DataFrame({'Name': ['a'], 'Data Source': ['x']}))
        with self.assertRaises(DataContractError) as caught:
            asyncio.run(route.search_for_duplicate_settlements(object(), 80, True))
        error = caught.exception
        self.assertEqual(error.code, 'missing_source_column')
        self.assertIn("'Source' column", error.message)
        self.assertIn('turn Cross-reference source off', error.message)
        self.assertEqual(error.details['found'], ['Name', 'Data Source'])
        self.assertIsNone(rec.search_args)


if __name__ == '__main__':
    unittest.main()
