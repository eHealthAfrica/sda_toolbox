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

    def test_blank_codes_are_not_duplicates_of_each_other_but_are_rejected_in_their_own_right(self):
        # They used to pass. A blank code cannot be tracked: the Voronoi step merges all blank codes into one record
        # and the dissolve drops them, so those settlements vanished from the result without a word.
        data = frame([((1, 1), 'g1', None), ((2, 2), 'g2', None)])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('2 settlements have a blank unique code', caught.exception.details)
        self.assertNotIn('duplicated unique code', caught.exception.details)
        self.assertEqual(caught.exception.msg, 'Missing Identifiers')

    def test_a_blank_code_is_pointed_at_by_its_guid(self):
        data = frame([((1, 1), 'g1', 'c1'), ((2, 2), 'guid-of-the-blank-one', None)])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('1 settlements have a blank unique code (e.g. guid-of-the-blank-one)', caught.exception.details)

    def test_a_code_of_only_spaces_is_blank(self):
        data = frame([((1, 1), 'g1', '   '), ((2, 2), 'g2', 'c2')])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('1 settlements have a blank unique code', caught.exception.details)

    def test_with_neither_code_nor_guid_the_row_in_the_file_is_named(self):
        data = Frame([((1, 1), 'g1', 'c1'), ((2, 2), None, None)], columns=['geometry', 'guid', 'code'])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertIn('a blank unique code (e.g. row 3)', caught.exception.details)  # index 1 = row 3 of the file

    def test_a_duplicate_is_still_called_duplicates_found_even_beside_a_blank_code(self):
        data = frame([((1, 1), 'g1', 'c1'), ((2, 2), 'g2', 'c1'), ((3, 3), 'g3', None)])
        with self.assertRaises(self.DataError) as caught:
            self.check(data, 'guid', 'code')
        self.assertEqual(caught.exception.msg, 'Duplicates Found')
        self.assertIn('2 settlements have a duplicated unique code', caught.exception.details)
        self.assertIn('1 settlements have a blank unique code', caught.exception.details)


# ---------------------------------------------------------------------------------------------- states

class FakeState:
    def __init__(self, name, value, code='XX'):
        self.name, self.value, self._code = name, value, code

    @property
    def state_code(self):
        if self._code is None:
            raise KeyError(self.name)
        return self._code


FAKE_STATES = [FakeState('Kano', 'Kano', 'KN'), FakeState('Akwa_Ibom', 'Akwa Ibom', 'AK'),
               FakeState('Fct', 'FCT', 'FC'), FakeState('Yobe', 'Yobe', None)]


class TestResolveRunStates(unittest.TestCase):
    def setUp(self):
        self.mod = run_summary()

    def resolve(self, values):
        return self.mod.resolve_run_states(values, FAKE_STATES)

    def test_known_states_get_their_codes_in_the_order_first_seen(self):
        info, skipped = self.resolve(['kano', 'KANO', 'Fct'])
        self.assertEqual(info, {'Kano': 'KN', 'Fct': 'FC'})
        self.assertEqual(skipped, [])

    def test_a_two_word_state_resolves_though_its_member_name_has_an_underscore(self):
        info, _ = self.resolve(['akwa ibom'])
        self.assertEqual(info, {'Akwa Ibom': 'AK'})

    def test_an_unknown_state_is_skipped_with_a_reason_and_the_others_still_run(self):
        info, skipped = self.resolve(['Kano', 'Kanoo'])
        self.assertEqual(info, {'Kano': 'KN'})
        self.assertEqual([(s.state, s.reason) for s in skipped], [('Kanoo', "'Kanoo' is not a recognised state name.")])

    def test_a_name_with_a_stray_space_is_reported_as_written(self):
        info, skipped = self.resolve([' Kano'])
        self.assertEqual(info, {})
        self.assertEqual(skipped[0].state, ' Kano')
        self.assertIn("' Kano' is not a recognised", skipped[0].reason)

    def test_blank_states_are_counted_in_one_entry(self):
        info, skipped = self.resolve(['Kano', None, float('nan'), '  ', ''])
        self.assertEqual(info, {'Kano': 'KN'})
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0].state, self.mod.NO_STATE)
        self.assertIn('4 settlement(s) have no state name', skipped[0].reason)

    def test_a_state_with_no_configured_code_is_skipped_not_crashed(self):
        info, skipped = self.resolve(['Yobe', 'Kano'])
        self.assertEqual(info, {'Kano': 'KN'})
        self.assertEqual(skipped[0].state, 'Yobe')
        self.assertIn('No state code is configured for Yobe', skipped[0].reason)

    def test_nothing_runnable_gives_an_empty_mapping_and_every_reason(self):
        info, skipped = self.resolve(['Nowhere', None])
        self.assertEqual(info, {})
        self.assertEqual(len(skipped), 2)
        self.assertIn('Nowhere', self.mod.skipped_summary_text(skipped))


class TestPlannedMatch(unittest.TestCase):
    def setUp(self):
        self.mod = run_summary()

    def test_counts_planned_codes_and_how_many_were_found(self):
        self.assertEqual(self.mod.planned_match(['a', 'b', 'c'], ['b', 'c', 'z']), (3, 2))

    def test_repeated_and_blank_planned_codes_are_not_counted(self):
        self.assertEqual(self.mod.planned_match(['a', 'a', None, '', '  ', float('nan')], ['a']), (1, 1))

    def test_nothing_in_common_is_zero_matched(self):
        self.assertEqual(self.mod.planned_match(['Kano_X'], ['kano|x']), (1, 0))

    def test_surrounding_spaces_do_not_break_a_match(self):
        self.assertEqual(self.mod.planned_match([' a '], ['a ']), (1, 1))

    def test_header_carries_the_planned_counts_only_when_given(self):
        with_planned = json.loads(self.mod.summary_header_value(['Kano'], [], 40, 38))
        self.assertEqual(with_planned['planned'], {'requested': 40, 'matched': 38})
        self.assertNotIn('planned', json.loads(self.mod.summary_header_value(['Kano'], [])))
        self.assertNotIn('planned', json.loads(self.mod.summary_header_value(['Kano'], [], None, None)))


# ---------------------------------------------------------------------------------------------- generate.py

def extract(relative, names, namespace):
    """Run just the named top-level functions / classes of a toolbox file (it imports geopandas, which is not here)."""
    tree = ast.parse((PACKAGE / relative).read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    assert {n.name for n in nodes} == set(names), f'missing from {relative}: {set(names) - {n.name for n in nodes}}'
    exec(compile(ast.Module(nodes, []), relative, 'exec'), namespace)
    return namespace


PlannedDataError = type('DataError', (Problem,), {})


def fake_detect(data):
    return next((c for c in data.columns if c.startswith('code_')), None)


def fake_construct(data, unique_col, settlement_col=None):
    if 'state' not in data.columns:
        raise PlannedDataError('Missing Field', 'state could not be detected')
    data.insert(0, unique_col, data['state'] + '_' + data['name'])
    return data


class TestPreparePlannedList(unittest.TestCase):
    def setUp(self):
        import re
        from typing import Optional
        self.error = PlannedDataError
        self.ns = extract('target_area/v1/generate.py', ['_plain', 'prepare_planned_list'], {
            're': re, 'Optional': Optional, 'gpd': types.SimpleNamespace(GeoDataFrame=object), 'DataError': self.error,
            'detect_unique_admin_field': fake_detect, 'construct_new_unique': fake_construct})

    def prepare(self, planned, unique_col='unique_code', uuid_mode=False):
        return self.ns['prepare_planned_list'](planned, unique_col, 'unique_code', uuid_mode)

    def test_no_planned_list_is_nothing_to_do(self):
        self.assertIsNone(self.prepare(None))

    def test_a_list_that_already_has_the_column_is_untouched(self):
        planned = pd.DataFrame({'unique_code': ['a']})
        self.assertIs(self.prepare(planned), planned)

    def test_a_column_that_differs_by_case_or_punctuation_is_used(self):
        planned = pd.DataFrame({'Unique Code': ['a', 'b']})
        result = self.prepare(planned)
        self.assertEqual(result['unique_code'].tolist(), ['a', 'b'])
        self.assertNotIn('unique_code', planned.columns)  # the upload's frame is not modified

    def test_uuid_mode_without_the_guid_column_is_refused_before_any_work_and_lists_the_columns(self):
        planned = pd.DataFrame({'state': ['Kano'], 'name': ['X']})
        with self.assertRaises(self.error) as caught:
            self.prepare(planned, 'eha_guid', uuid_mode=True)
        self.assertEqual(caught.exception.msg, 'Planned List')
        self.assertIn("no 'eha_guid' column", caught.exception.details)
        self.assertIn('state, name', caught.exception.details)

    def test_uuid_mode_finds_a_guid_column_spelled_differently(self):
        planned = pd.DataFrame({'EHA-GUID': ['g1']})
        self.assertEqual(self.prepare(planned, 'eha_guid', uuid_mode=True)['eha_guid'].tolist(), ['g1'])

    def test_a_list_with_its_own_unique_field_under_another_name_uses_it(self):
        planned = pd.DataFrame({'code_settlement': ['Kano_A', 'Kano_B']})
        self.assertEqual(self.prepare(planned)['unique_code'].tolist(), ['Kano_A', 'Kano_B'])

    def test_otherwise_the_code_is_built_from_the_names_like_the_master_lists(self):
        planned = pd.DataFrame({'state': ['Kano'], 'name': ['Dala']})
        self.assertEqual(self.prepare(planned)['unique_code'].tolist(), ['Kano_Dala'])

    def test_a_list_that_cannot_be_matched_at_all_says_so_with_its_columns(self):
        planned = pd.DataFrame({'something': [1], 'else': [2]})
        with self.assertRaises(self.error) as caught:
            self.prepare(planned)
        self.assertEqual(caught.exception.msg, 'Planned List')
        self.assertIn("no 'unique_code' column", caught.exception.details)
        self.assertIn('something, else', caught.exception.details)


class GridFrame(pd.DataFrame):
    """A DataFrame that can be 'reprojected', for compile_datasets."""
    @property
    def _constructor(self):
        return GridFrame

    def to_crs(self, *_a, **_k):
        return self


class TestCompileDatasets(unittest.TestCase):
    def setUp(self):
        import logging
        from dataclasses import dataclass, field
        from typing import Optional
        self.error = type('DataError', (Problem,), {})
        mod = run_summary()
        self.ns = extract('target_area/v1/generate.py', ['TADatasets', 'compile_datasets'], {
            'logging': logging, 'pd': pd, 'dataclass': dataclass, 'field': field, 'Optional': Optional,
            'gpd': types.SimpleNamespace(GeoDataFrame=GridFrame), 'DataError': self.error,
            'SkippedState': mod.SkippedState, 'planned_match': mod.planned_match})

    def datasets(self, codes_by_state):
        out = []
        for codes in codes_by_state:
            frame = GridFrame({'unique_code': codes, 'v': range(len(codes))})
            out.append(self.ns['TADatasets'](voronoi=frame, gridded_ta=frame))
        return out

    def compile(self, generated, planned_codes):
        planned = GridFrame({'unique_code': planned_codes})
        return self.ns['compile_datasets'](self.datasets(generated), 'unique_code', planned)

    def test_all_planned_settlements_found(self):
        result = self.compile([['a', 'b'], ['c']], ['a', 'c'])
        self.assertEqual((result.planned_requested, result.planned_matched), (2, 2))
        self.assertEqual(result.voronoi_subset['unique_code'].tolist(), ['a', 'c'])

    def test_a_planned_list_in_another_code_format_matches_nothing_and_says_so(self):
        result = self.compile([['Kano_Dala_W_A']], ['kano|dala|w|a', 'kano|dala|w|b'])
        self.assertEqual((result.planned_requested, result.planned_matched), (2, 0))
        self.assertEqual(len(result.voronoi_subset), 0)

    def test_some_missing_is_counted_and_blank_planned_codes_are_not(self):
        result = self.compile([['a', 'b']], ['a', 'zzz', None])
        self.assertEqual((result.planned_requested, result.planned_matched), (2, 1))

    def test_without_a_planned_list_there_are_no_counts(self):
        result = self.ns['compile_datasets'](self.datasets([['a']]), 'unique_code', None)
        self.assertIsNone(result.planned_requested)
        self.assertIsNone(result.planned_matched)


# ---------------------------------------------------------------------------------------------- common.py

class TestStandardizeKeepsTheUniqueCodeName(unittest.TestCase):
    def setUp(self):
        import logging
        import re
        import numpy as np
        self.built = []

        def construct(data, unique_col, settlement_col=None):
            self.built.append(unique_col)
            data.insert(0, unique_col, data['settlement'].astype(str))
            return data

        self.ns = extract('mlos/transformers/common.py', ['standardize_attribute_values'], {
            'logging': logging, 're': re, 'np': np, 'pd': pd,
            'CONFIG': {'EXCLUSIONS': [], 'REGEX': {'WHITE_SPACE': r'\s+'}, 'ABBREVS': {'SETTLEMENT': {}}},
            'find_column': lambda *a, **k: None,
            'get_admin_col': lambda data, kind, *a, **k: 'settlement',
            'detect_unique_admin_field': lambda data: 'unique_code' if 'unique_code' in data.columns else None,
            'construct_new_unique': construct,
            'update_abbreviations': lambda row, col: row.get(col),
            'standardize_value': lambda value: value,
        })

    def run_it(self, data, unique_code=None):
        return self.ns['standardize_attribute_values'](data, ['settlement'], unique_code)

    def test_the_code_is_rebuilt_under_the_same_name(self):
        data = pd.DataFrame({'unique_code': ['old'], 'settlement': ['x']})
        result = self.run_it(data, 'unique_code')
        self.assertEqual(result['unique_code'].tolist(), ['x'])
        self.assertEqual(list(result.columns).count('unique_code'), 1)

    def test_a_stale_name_that_is_no_longer_a_column_does_not_crash_the_drop(self):
        # e.g. the column was renamed to lower case after the caller found it as 'Unique Code'
        data = pd.DataFrame({'unique_code': ['old'], 'settlement': ['x']})
        result = self.run_it(data, 'Unique Code')
        self.assertEqual(self.built, ['Unique Code'])  # rebuilt under the name the caller uses
        self.assertIn('Unique Code', result.columns)

    def test_a_file_with_no_code_column_gets_one_named_unique_code_not_none(self):
        data = pd.DataFrame({'settlement': ['x']})
        result = self.run_it(data)
        self.assertEqual(self.built, ['unique_code'])
        self.assertEqual(result['unique_code'].tolist(), ['x'])


if __name__ == '__main__':
    unittest.main()
