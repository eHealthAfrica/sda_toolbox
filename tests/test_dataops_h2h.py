"""Tests for the H2H data checks (toolbox/dataops/h2h.py).

Run from the repo root:  python -m unittest tests.test_dataops_h2h -v
Pandas only (see test_dataops.py): tracks are the FakeGDF stand-in, and the
tool's own fuzzy column finders are replaced by simple ones.
"""
import enum
import unittest

import numpy as np
import pandas as pd

from tests.test_dataops import FakeGDF, tracks
from toolbox.errors import DataContractError
from toolbox.dataops import h2h
from toolbox.dataops.checks import Report


def admin_finder(df, level):
    for col in df.columns:
        if level in str(col).lower():
            return col
    return None


def unique_finder(df):
    return 'Unique' if 'Unique' in df.columns else None


FINDERS = {'find_admin_col': admin_finder, 'find_unique_col': unique_finder}


def dip(n=30, **over):
    data = {
        'STATE': ['Kano'] * n,
        'LGA': [f'Lga{i % 3}' for i in range(n)],
        'WARD': [f'Ward{i % 5}' for i in range(n)],
        'SETTLEMENT': [f'Settlement{i}' for i in range(n)],
        'day_1': ['Yes'] * n,
    }
    data.update(over)
    return pd.DataFrame(data)


class FakeState(enum.Enum):
    Kano = 'Kano'
    Kaduna = 'Kaduna'


def codes(report):
    return [f.code for f in report.findings]


class SettlementList(unittest.TestCase):
    def check(self, settlements, day=1, **kw):
        return h2h.validate_settlements(settlements, day, **FINDERS, **kw)

    def test_a_good_list_passes_without_findings(self):
        self.assertEqual(self.check(dip()).findings, [])

    def test_analysis_day_must_be_positive(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(), day=0)
        self.assertEqual(ctx.exception.code, 'invalid_analysis_day')

    def test_empty_list_is_fatal_and_skips_the_column_checks(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(0))
        self.assertEqual(ctx.exception.code, 'no_settlements')
        self.assertEqual([p['code'] for p in ctx.exception.details['problems']], ['no_settlements'])

    def test_missing_state_column(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip().drop(columns='STATE'))
        self.assertEqual(ctx.exception.code, 'missing_state_column')
        problem = ctx.exception.details['problems'][0]
        self.assertIn('LGA', problem['details']['columns_found'])

    def test_no_unique_code_and_missing_admin_columns(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip().drop(columns=['WARD', 'SETTLEMENT']))
        self.assertEqual(ctx.exception.code, 'no_unique_settlement_code')
        self.assertEqual(ctx.exception.details['problems'][0]['details']['missing'], ['ward', 'settlement'])
        self.assertIn('ward, settlement', ctx.exception.message)

    def test_a_unique_code_column_is_enough_without_admin_columns(self):
        data = dip().drop(columns=['LGA', 'WARD', 'SETTLEMENT'])
        data['Unique'] = 'Kano_A_B_C'
        self.assertEqual(self.check(data).findings, [])

    def test_blank_names_are_a_warning_above_five_percent(self):
        report = self.check(dip(SETTLEMENT=[None] * 3 + [f's{i}' for i in range(27)]))      # 10%
        self.assertEqual(codes(report), ['incomplete_settlement_names'])
        self.assertFalse(report.findings[0].fatal)
        self.assertEqual(report.findings[0].details['blank'], 3)

    def test_few_blank_names_pass(self):
        self.assertEqual(self.check(dip(60, SETTLEMENT=[None] * 3 + [f's{i}' for i in range(57)])).findings, [])  # 5%

    def test_whitespace_only_names_count_as_blank(self):
        report = self.check(dip(WARD=['  '] * 6 + ['W'] * 24))
        self.assertEqual(report.findings[0].details['blank'], 6)

    def test_later_days_need_the_previous_days_result(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(), day=3)
        self.assertEqual(ctx.exception.code, 'previous_day_missing')
        self.assertIn("'day_2_cumm'", ctx.exception.message)
        self.assertIn('day 2', ctx.exception.message)

    def test_previous_day_present_passes(self):
        self.assertEqual(self.check(dip(day_2_cumm=['Visited'] * 30), day=3).findings, [])

    def test_day_one_needs_no_previous_day(self):
        self.assertEqual(self.check(dip(), day=1).findings, [])

    def test_other_cumulative_columns_are_listed_as_a_hint(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(day_1_cumm=['Visited'] * 30), day=3)
        details = ctx.exception.details['problems'][0]['details']
        self.assertEqual(details['needed'], 'day_2_cumm')
        self.assertEqual(details['cumulative_columns_found'], ['day_1_cumm'])

    def test_columns_the_analysis_creates_are_rejected(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(visitation=['Visited'] * 30, track_count=[1] * 30))
        self.assertEqual(ctx.exception.code, 'reserved_columns')
        self.assertEqual(ctx.exception.details['problems'][0]['details']['columns'], ['visitation', 'track_count'])

    def test_several_problems_are_named_together(self):
        with self.assertRaises(DataContractError) as ctx:
            self.check(dip(visitation=['x'] * 30), day=2)
        self.assertEqual(
            [p['code'] for p in ctx.exception.details['problems']], ['previous_day_missing', 'reserved_columns'])
        self.assertEqual(ctx.exception.details['tool'], 'h2h')

    def test_finder_errors_count_as_not_found(self):
        def broken(df, level):
            raise RuntimeError('boom')
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_settlements(dip(), 1, find_admin_col=broken, find_unique_col=unique_finder)
        self.assertEqual(ctx.exception.code, 'missing_state_column')

    def test_warnings_are_not_logged_until_check_output(self):
        with self.assertNoLogs(level='WARNING'):
            self.check(dip(SETTLEMENT=[None] * 3 + [f's{i}' for i in range(27)]))


class TracksFile(unittest.TestCase):
    def test_good_tracks_pass(self):
        self.assertEqual(h2h.validate_tracks(tracks(20)).findings, [])

    def test_no_tracks_left_is_fatal(self):
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_tracks(tracks(0))
        self.assertEqual(ctx.exception.code, 'no_valid_tracks')
        self.assertIn('07:00-16:59', ctx.exception.message)

    def test_missing_coordinate_system_is_fatal(self):
        data = tracks(20)
        data.crs = None
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_tracks(data)
        self.assertEqual(ctx.exception.code, 'missing_crs')

    def test_missing_geometry_column_is_fatal(self):
        data = FakeGDF({'Lat': [1.0] * 5})
        data.crs = 'EPSG:4326'
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_tracks(data)
        self.assertEqual(ctx.exception.code, 'missing_columns')

    def test_some_bad_locations_warn_and_most_fail(self):
        warned = h2h.validate_tracks(tracks(100, geometry=[None] * 10 + ['P'] * 90))
        self.assertEqual(codes(warned), ['invalid_geometries'])
        with self.assertRaises(DataContractError):
            h2h.validate_tracks(tracks(100, geometry=[None] * 60 + ['P'] * 40))

    def test_tracks_findings_join_the_settlement_findings(self):
        report = Report(h2h.TOOL)
        h2h.validate_settlements(dip(SETTLEMENT=[None] * 3 + [f's{i}' for i in range(27)]), 1, report=report, **FINDERS)
        h2h.validate_tracks(tracks(100, geometry=[None] * 10 + ['P'] * 90), report=report)
        self.assertEqual(codes(report), ['incomplete_settlement_names', 'invalid_geometries'])


class Combined(unittest.TestCase):
    def test_validate_input_reports_both_halves_at_once(self):
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_input(dip(), tracks(0), 2, **FINDERS)
        self.assertEqual(
            [p['code'] for p in ctx.exception.details['problems']], ['previous_day_missing', 'no_valid_tracks'])

    def test_a_missing_state_column_also_means_no_unique_code_can_be_built(self):
        with self.assertRaises(DataContractError) as ctx:
            h2h.validate_input(dip().drop(columns='STATE'), tracks(20), 1, **FINDERS)
        self.assertEqual(
            [p['code'] for p in ctx.exception.details['problems']], ['missing_state_column', 'no_unique_settlement_code'])

    def test_validate_input_passes_good_data(self):
        self.assertEqual(h2h.validate_input(dip(), tracks(20), 1, **FINDERS).findings, [])


class States(unittest.TestCase):
    def test_known_states(self):
        self.assertEqual(h2h.resolve_states(pd.Series([' kano ', 'KADUNA', 'Kano']), FakeState),
                         [FakeState.Kano, FakeState.Kaduna])

    def test_unknown_state_is_a_data_error_naming_the_tool(self):
        with self.assertRaises(DataContractError) as ctx:
            h2h.resolve_states(pd.Series(['Kano', 'Atlantis']), FakeState)
        self.assertEqual(ctx.exception.code, 'unknown_states')
        self.assertEqual(ctx.exception.details['tool'], 'h2h')
        self.assertIn("'Atlantis'", ctx.exception.message)

    def test_blank_state_is_a_data_error(self):
        with self.assertRaises(DataContractError) as ctx:
            h2h.resolve_states(pd.Series(['Kano', None]), FakeState)
        self.assertEqual(ctx.exception.code, 'missing_state_values')


class Output(unittest.TestCase):
    def result(self, n=30, coverage=None):
        return pd.DataFrame({'Settlement Coverage': coverage or ['Fully Covered'] * n})

    def test_a_normal_result_has_no_warnings(self):
        report = h2h.check_output(Report(h2h.TOOL), self.result(), 30)
        self.assertEqual(report.findings, [])
        self.assertEqual(report.headers(), {})

    def test_empty_result_warns(self):
        report = h2h.check_output(Report(h2h.TOOL), self.result(0), 30)
        self.assertIn('empty_result', codes(report))
        self.assertFalse(any(f.fatal for f in report.findings))

    def test_rows_lost_and_rows_gained(self):
        self.assertEqual(codes(h2h.check_output(Report(h2h.TOOL), self.result(25), 30)), ['rows_lost'])
        self.assertEqual(codes(h2h.check_output(Report(h2h.TOOL), self.result(40), 30)), ['rows_gained'])

    def test_no_coverage_at_all_warns_for_a_real_sized_list(self):
        report = h2h.check_output(Report(h2h.TOOL), self.result(coverage=['No Coverage'] * 30), 30)
        self.assertEqual(codes(report), ['no_settlement_covered'])
        self.assertIn('30', report.findings[0].message)
        self.assertIn('no_settlement_covered', report.headers()['X-Data-Warning'])

    def test_a_few_uncovered_settlements_are_normal(self):
        coverage = ['No Coverage'] * 29 + ['Poorly Covered']
        self.assertEqual(h2h.check_output(Report(h2h.TOOL), self.result(coverage=coverage), 30).findings, [])

    def test_tiny_lists_are_not_judged(self):
        self.assertEqual(h2h.check_output(Report(h2h.TOOL), self.result(coverage=['No Coverage'] * 5), 5).findings, [])

    def test_warnings_from_the_input_checks_reach_the_header(self):
        report = Report(h2h.TOOL)
        h2h.validate_tracks(tracks(100, geometry=[None] * 10 + ['P'] * 90), report=report)
        h2h.check_output(report, self.result(), 30)
        self.assertIn('invalid_geometries', report.headers()['X-Data-Warning'])


if __name__ == '__main__':
    unittest.main()
