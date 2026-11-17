"""Tests for the MLoS QC data checks (toolbox/dataops/mlos.py).

Run from the repo root:  python -m unittest tests.test_dataops_mlos -v
Pandas only: the tool's own coordinate finder (GeomColumns, which needs the spatial libraries) is
replaced by `find_geom_cols`, the way the REACH checks are tested.
"""
import asyncio
import io
import os
import tempfile
import unittest
from types import SimpleNamespace

import numpy as np
import pandas as pd
from starlette.responses import PlainTextResponse

from tests import test_reliability as base  # noqa: F401  (throwaway DB, puts the package on sys.path)
from tests.test_reliability import asgi_call, latest_job, make_app

from toolbox.errors import DataContractError
from toolbox.dataops import mlos as checks
from toolbox.dataops.checks import Report, WARNING_HEADER


def finder(latitude='lat', longitude='lon'):
    return lambda data: SimpleNamespace(latitude=latitude, longitude=longitude)


def failing_finder(error):
    def find(data):
        raise error
    return find


def mlos(n=30, **over):
    data = {
        'unique_code': [f'Kano|Dala|Ward{i % 5}|Place{i}' for i in range(n)],
        'lat': np.linspace(11.9, 12.1, n),
        'lon': np.linspace(8.4, 8.6, n),
    }
    data.update(over)
    return pd.DataFrame(data)


def validate(data, **kwargs):
    kwargs.setdefault('find_geom_cols', finder())
    return checks.validate_input(data, 'unique_code', **kwargs)


def codes(report):
    return [f.code for f in report.findings]


class InputThatStopsTheRun(unittest.TestCase):
    def test_an_empty_file_is_refused_with_a_clear_message(self):
        with self.assertRaises(DataContractError) as caught:
            validate(mlos(0))
        self.assertEqual(caught.exception.code, 'empty_mlos')
        self.assertIn('no rows', caught.exception.message)

    def test_missing_coordinate_columns_are_refused_and_the_columns_found_are_listed(self):
        with self.assertRaises(DataContractError) as caught:
            validate(mlos(), find_geom_cols=failing_finder(ValueError('x Field Found')))
        self.assertEqual(caught.exception.code, 'no_coordinate_columns')
        self.assertIn('numeric', caught.exception.message)
        self.assertEqual(caught.exception.details['problems'][0]['details']['columns_found'],
                         ['unique_code', 'lat', 'lon'])

    def test_a_finder_that_names_columns_the_file_does_not_have_is_refused_too(self):
        with self.assertRaises(DataContractError) as caught:
            validate(mlos(), find_geom_cols=finder('nope', 'also nope'))
        self.assertEqual(caught.exception.code, 'no_coordinate_columns')

    def test_only_one_coordinate_column_is_refused(self):
        with self.assertRaises(DataContractError):
            validate(mlos(), find_geom_cols=finder('lat', None))

    def test_when_the_spatial_libraries_are_missing_the_coordinates_are_not_judged(self):
        report = validate(mlos(), find_geom_cols=failing_finder(ImportError('no geopandas')))
        self.assertEqual(report.findings, [])


class InputWarnings(unittest.TestCase):
    def test_a_clean_file_has_no_warnings_and_no_header(self):
        report = validate(mlos())
        self.assertEqual(report.warnings, [])
        self.assertEqual(report.headers(), {})

    def test_records_without_a_built_code_are_reported_as_missing_names(self):
        codes_ = [f'Kano|Dala|W{i}|P{i}' for i in range(28)] + [np.nan, None]
        report = validate(mlos(unique_code=codes_), unique_code_built=True)
        finding = report.warnings[0]
        self.assertEqual(finding.code, 'missing_unique_codes')
        self.assertFalse(finding.fatal)
        self.assertIn('2 record(s) are missing a state, LGA, ward or settlement name', finding.message)

    def test_records_without_a_code_in_the_files_own_column_name_the_column(self):
        report = validate(mlos(unique_code=[''] + [f'a|b|c|{i}' for i in range(29)]))
        self.assertIn("no value in the unique code column 'unique_code'", report.warnings[0].message)

    def test_blank_impossible_and_origin_coordinates_are_counted_separately(self):
        lat = [12.0] * 30
        lon = [8.5] * 30
        lat[0], lon[1] = np.nan, np.nan          # blank
        lat[2] = 912.0                           # impossible (the decimal point slipped)
        lon[3] = 190.0                           # impossible
        lat[4], lon[4] = 0.0, 0.0                # null island
        report = validate(mlos(lat=lat, lon=lon))
        finding = report.warnings[0]
        self.assertEqual(finding.code, 'unusable_coordinates')
        self.assertFalse(finding.fatal)
        self.assertEqual((finding.details['blank'], finding.details['impossible'], finding.details['origin']), (2, 2, 1))
        self.assertIn('5 of 30 records (16.7%)', finding.message)

    def test_a_point_on_the_equator_or_the_meridian_alone_is_fine(self):
        lat = [12.0] * 30
        lon = [8.5] * 30
        lat[0] = 0.0
        lon[1] = 0.0
        self.assertEqual(validate(mlos(lat=lat, lon=lon)).warnings, [])

    def test_numbers_stored_as_text_still_count_as_coordinates(self):
        report = validate(mlos(lat=['12.1'] * 30, lon=['8.5'] * 29 + ['not a number']))
        self.assertEqual(report.warnings[0].details['blank'], 1)

    def test_warnings_never_raise_and_both_can_appear_together(self):
        data = mlos(unique_code=[np.nan] + [f'a|b|c|{i}' for i in range(29)])
        data.loc[1, 'lat'] = np.nan
        report = validate(data, unique_code_built=True)
        self.assertEqual(sorted(codes(report)), ['missing_unique_codes', 'unusable_coordinates'])
        self.assertTrue(all(not f.fatal for f in report.findings))

    def test_the_row_contents_are_not_quoted_in_the_header(self):
        report = validate(mlos(unique_code=[np.nan] + [f'secret|x|y|{i}' for i in range(29)]), unique_code_built=True)
        self.assertNotIn('secret', report.headers()[WARNING_HEADER])


def result(n=100, flagged=0, set_aside=0, **over):
    data = {
        'unique_code': [f'c{i}' for i in range(n)],
        'is_flagged': ['Flagged'] * flagged + [np.nan] * (n - flagged),
        'validation_status': ['Validated Unknown'] * set_aside + ['Validated'] * (n - set_aside),
    }
    data.update(over)
    return pd.DataFrame(data)


class OutputWarnings(unittest.TestCase):
    def check(self, out, rows_in=None):
        return checks.check_output(Report(checks.TOOL), out, len(out) if rows_in is None else rows_in)

    def test_a_normal_result_has_no_warnings(self):
        self.assertEqual(self.check(result(flagged=12, set_aside=3)).warnings, [])

    def test_lost_rows_are_reported(self):
        report = self.check(result(90), rows_in=100)
        self.assertEqual(codes(report), ['rows_lost'])
        self.assertIn('10 row(s) were dropped or merged', report.findings[0].message)

    def test_gained_rows_are_reported(self):
        self.assertEqual(codes(self.check(result(110), rows_in=100)), ['rows_gained'])

    def test_a_tiny_difference_is_not(self):
        self.assertEqual(self.check(result(101), rows_in=100).findings, [])

    def test_most_flagged_names_the_count_and_what_to_check(self):
        report = self.check(result(flagged=60))
        self.assertEqual(codes(report), ['most_flagged'])
        self.assertIn('60.0% of settlements (60 of 100) were flagged', report.findings[0].message)
        self.assertIn('coordinate system', report.findings[0].message)

    def test_exactly_the_threshold_is_not_most(self):
        self.assertEqual(self.check(result(flagged=50)).warnings, [])

    def test_most_set_aside_says_that_most_of_the_file_was_not_checked(self):
        report = self.check(result(set_aside=70))
        self.assertEqual(codes(report), ['most_set_aside'])
        self.assertIn('most of the file was not checked', report.findings[0].message)

    def test_small_tables_are_not_judged_by_a_share(self):
        self.assertEqual(self.check(result(10, flagged=10, set_aside=10)).warnings, [])

    def test_a_result_without_those_columns_is_fine(self):
        self.assertEqual(self.check(pd.DataFrame({'unique_code': ['a', 'b']})).warnings, [])

    def test_output_findings_are_warnings_and_join_the_input_ones(self):
        report = validate(mlos(unique_code=[np.nan] + [f'a|b|c|{i}' for i in range(29)]), unique_code_built=True)
        checks.check_output(report, result(flagged=80), 100)
        self.assertEqual(sorted(codes(report)), ['missing_unique_codes', 'most_flagged'])
        self.assertTrue(all(not f.fatal for f in report.findings))
        header = report.headers()[WARNING_HEADER]
        self.assertIn('missing_unique_codes', header)
        self.assertIn('most_flagged', header)


class ThroughTheJobTracker(unittest.TestCase):
    def run_app(self, handler):
        return asyncio.run(asgi_call(make_app(handler)))

    def test_warnings_reach_the_response_and_the_job_row(self):
        async def handler(request):
            report = validate(mlos(lat=[np.nan] * 30))
            return PlainTextResponse('csv', headers=report.headers())

        sent, raised = self.run_app(handler)
        self.assertIsNone(raised)
        self.assertIn('unusable_coordinates', dict(sent[0]['headers'])[b'x-data-warning'].decode())
        job = latest_job()
        self.assertEqual(job['status'], 'completed')
        self.assertIn('unusable_coordinates', job['data_warning'])

    def test_a_refusal_is_a_422_filed_as_a_data_contract_problem(self):
        async def handler(request):
            validate(mlos(), find_geom_cols=failing_finder(ValueError('x')))

        sent, raised = self.run_app(handler)
        self.assertIsNone(raised)
        self.assertEqual(sent[0]['status'], 422)
        job = latest_job()
        self.assertEqual((job['status'], job['error_category'], job['error_type']),
                         ('failed', 'data_contract', 'no_coordinate_columns'))


if __name__ == '__main__':
    unittest.main()
