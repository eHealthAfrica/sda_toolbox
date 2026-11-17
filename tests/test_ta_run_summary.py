"""What a Target Area run reports about each state (ran / skipped and why), and the duplicate check that skips one.

Run from the repo root:  python -m unittest tests.test_ta_run_summary -v
run_summary.py has no geospatial imports and is loaded as is. preview_settlements is read out of ta_tools.py and
run against a small pandas frame that looks like a GeoDataFrame (geopandas itself is not needed).
"""
import ast
import importlib.util
import json
import os
import types
import unittest
from pathlib import Path

import pandas as pd

PACKAGE = Path(os.environ.get('TOOLBOX_SRC_DIR', Path(__file__).resolve().parents[1] / 'src' / 'toolbox'))


class Problem(Exception):
    """Stand-in for the toolbox exceptions: (message, details)."""
    def __init__(self, msg='', details=None):
        super().__init__(msg)
        self.msg, self.details = msg, details


def run_summary():
    spec = importlib.util.spec_from_file_location('ta_run_summary_under_test', PACKAGE / 'target_area' / 'run_summary.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSkipReason(unittest.TestCase):
    def setUp(self):
        self.mod = run_summary()

    def test_toolbox_error_uses_message_and_details(self):
        self.assertEqual(self.mod.skip_reason(Problem('Duplicates Found', '3 settlements share a location')),
                         'Duplicates Found: 3 settlements share a location')

    def test_message_only_when_there_are_no_details(self):
        self.assertEqual(self.mod.skip_reason(Problem('No Data', None)), 'No Data')

    def test_unexpected_error_names_its_type(self):
        self.assertEqual(self.mod.skip_reason(KeyError('geometry')), "Unexpected error (KeyError): 'geometry'")

    def test_is_one_line_and_capped(self):
        text = self.mod.skip_reason(Problem('Bad', 'line one\nline   two\n' + 'x' * 1000))
        self.assertNotIn('\n', text)
        self.assertNotIn('  ', text)
        self.assertLessEqual(len(text), self.mod.MAX_REASON_LENGTH)
        self.assertTrue(text.endswith('...'))


class TestSummaryHeader(unittest.TestCase):
    def setUp(self):
        self.mod = run_summary()

    def test_round_trips_as_json(self):
        skipped = [self.mod.SkippedState('Zamfara', 'Duplicates Found: 4 shared'), self.mod.SkippedState('Yobe', 'No Data')]
        value = json.loads(self.mod.summary_header_value(['Borno', 'Kano'], skipped))
        self.assertEqual(value, {'states_run': ['Borno', 'Kano'],
                                 'skipped': [{'state': 'Zamfara', 'reason': 'Duplicates Found: 4 shared'},
                                             {'state': 'Yobe', 'reason': 'No Data'}]})

    def test_header_is_ascii_even_with_accented_text(self):
        header = self.mod.summary_header_value([], [self.mod.SkippedState('Kano', 'Gwale – café ❌')])
        header.encode('ascii')
        self.assertIn('café', json.loads(header)['skipped'][0]['reason'])

    def test_nothing_skipped_still_lists_the_states_run(self):
        self.assertEqual(json.loads(self.mod.summary_header_value(['Borno'], [])), {'states_run': ['Borno'], 'skipped': []})

    def test_very_long_reasons_are_shortened_not_dropped(self):
        skipped = [self.mod.SkippedState(f'State {i}', 'r' * 300) for i in range(40)]
        header = self.mod.summary_header_value([], skipped)
        self.assertLessEqual(len(header), self.mod.MAX_HEADER_LENGTH)
        self.assertEqual(len(json.loads(header)['skipped']), 40)

    def test_text_for_the_all_failed_message(self):
        skipped = [self.mod.SkippedState('Kano', 'a'), self.mod.SkippedState('Sokoto', 'b')]
        self.assertEqual(self.mod.skipped_summary_text(skipped), 'Kano: a; Sokoto: b')
        self.assertEqual(self.mod.skipped_summary_text([]), '')


class Frame(pd.DataFrame):
    """A DataFrame with the one GeoDataFrame feature preview_settlements uses: .geometry.x / .geometry.y."""
    @property
    def _constructor(self):
        return Frame

    @property
    def geometry(self):
        points = self['geometry']
        return types.SimpleNamespace(x=points.map(lambda p: p[0]), y=points.map(lambda p: p[1]))


def preview_settlements():
    tree = ast.parse((PACKAGE / 'target_area' / 'ta_tools.py').read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'preview_settlements')
    namespace = {'DataError': type('DataError', (Problem,), {}), 'pd': pd, 'gpd': types.SimpleNamespace(GeoDataFrame=object)}
    exec(compile(ast.Module([node], []), 'ta_tools.preview_settlements', 'exec'), namespace)
    return namespace['preview_settlements'], namespace['DataError']


def frame(rows):
    return Frame(rows, columns=['geometry', 'guid', 'code'])


class TestPreviewSettlements(unittest.TestCase):
    def setUp(self):
        self.check, self.DataError = preview_settlements()

    def test_clean_state_passes_and_drops_zero_coordinates(self):
        data = frame([((1, 1), 'g1', 'c1'), ((2, 2), 'g2', 'c2'), ((0, 0), 'g3', 'c3')])
        self.assertEqual(len(self.check(data, 'guid', 'code')), 2)

    def test_shared_location_is_reported_with_a_count_and_example(self):
        data = frame([((1, 1), 'g1', 'c1'), ((1, 1), 'g2', 'c2'), ((2, 2), 'g3', 'c3')])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertEqual(caught.exception.msg, 'Duplicates Found')
        self.assertIn('2 settlements have a location shared with another settlement', caught.exception.details)
        self.assertIn('c1', caught.exception.details)

    def test_duplicate_code_and_guid_are_each_reported(self):
        data = frame([((1, 1), 'g1', 'c1'), ((2, 2), 'g1', 'c1'), ((3, 3), 'g3', 'c3')])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('duplicated unique code', caught.exception.details)
        self.assertIn('duplicated GUID', caught.exception.details)

    def test_a_missing_guid_stops_the_state(self):
        data = frame([((1, 1), 'g1', 'c1'), ((2, 2), None, 'c2')])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('1 settlements have a missing GUID', caught.exception.details)

    def test_blank_codes_are_not_duplicates_of_each_other(self):
        data = frame([((1, 1), 'g1', None), ((2, 2), 'g2', None)])
        self.assertEqual(len(self.check(data, 'guid', 'code')), 2)


if __name__ == '__main__':
    unittest.main()
