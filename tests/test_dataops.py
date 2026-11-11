"""Tests for the data checks (toolbox/dataops) and the data_warning plumbing.

Run from /home/claude/work:  python3 -m unittest tests.test_dataops -v
Pandas only: geopandas is not installable in the build sandbox, so tracks are
a DataFrame subclass with the two things the checks read from a GeoDataFrame
(`.geometry` and `.crs`). The tools' own fuzzy column finders are replaced by
the `find_admin_col` / `find_geom_cols` arguments.
"""
import asyncio
import enum
import unittest

import numpy as np
import pandas as pd

from tests import test_reliability as base  # throwaway DB + package imports
from tests.test_reliability import asgi_call, latest_job, make_app, rows, store
from starlette.responses import PlainTextResponse

from toolbox.errors import DataContractError
from toolbox.dataops import checks, gts, reach
from toolbox.dataops.checks import (
    Finding, Report, WARNING_HEADER, require_columns, require_non_empty, require_text_columns, require_crs,
    max_invalid_geometries, max_null_share, max_duplicate_share, max_value_share, row_count_ratio,
)


class FakeGDF(pd.DataFrame):
    _metadata = ['crs']

    @property
    def _constructor(self):
        return FakeGDF

    @property
    def geometry(self):
        return self['geometry']


def tracks(n=20, **over):
    data = {
        'IMEI': [f'IMEI{i}' for i in range(n)],
        'Team Code': ['KN-ABC-DEF1-CMP-001'] * n,
        'timestamp': pd.date_range('2026-10-01 08:00', periods=n, freq='min'),
        'Lat': np.linspace(12.0, 12.1, n), 'Lon': np.linspace(8.0, 8.1, n),
        'Accuracy m': [5.0] * n, 'Speed mps': [0.2] * n,
        'Track ID': list(range(n)), 'geometry': ['POINT'] * n,
    }
    data.update(over)
    gdf = FakeGDF(data)
    gdf.crs = 'EPSG:4326'
    return gdf


class FakeState(enum.Enum):
    Kano = 'Kano'
    Kaduna = 'Kaduna'
    Borno = 'Borno'


# ======================================================================
class GenericChecks(unittest.TestCase):
    def test_require_columns(self):
        df = pd.DataFrame({'A': [1], 'Team code': [1]})
        self.assertIsNone(require_columns(df, ['A'], 'File'))
        f = require_columns(df, ['A', 'Team Code', 'Zed'], 'File')
        self.assertEqual((f.code, f.fatal), ('missing_columns', True))
        self.assertEqual(f.details['missing'], ['Team Code', 'Zed'])
        self.assertEqual(f.details['did_you_mean'], {'Team Code': 'Team code'})
        self.assertIn("'Team code' for 'Team Code'", f.message)
        self.assertNotIn('similar', require_columns(df, ['Zed'], 'File').message)
        self.assertFalse(require_columns(df, ['Zed'], 'File', fatal=False).fatal)

    def test_non_empty(self):
        self.assertIsNone(require_non_empty(pd.DataFrame({'a': [1]}), 'X'))
        f = require_non_empty(pd.DataFrame({'a': []}), 'The file', code='nothing', message='Nothing here.')
        self.assertEqual((f.code, f.message, f.fatal), ('nothing', 'Nothing here.', True))

    def test_text_columns(self):
        df = pd.DataFrame({'ok': ['a', None], 'blank': [np.nan, np.nan], 'num': [1, 2]})
        self.assertIsNone(require_text_columns(df, ['ok', 'absent'], 'file'))
        f = require_text_columns(df, ['ok', 'blank', 'num'], 'file')
        self.assertEqual(f.details['columns'], ['blank', 'num'])

    def test_crs(self):
        g = tracks()
        self.assertIsNone(require_crs(g, 'T'))
        g.crs = None
        self.assertEqual(require_crs(g, 'T').code, 'missing_crs')

        class Crs:
            def __init__(self, epsg):
                self.epsg = epsg

            def to_epsg(self):
                return self.epsg

        g.crs = Crs(32632)
        f = require_crs(g, 'T', expected_epsg=4326)
        self.assertEqual((f.code, f.fatal), ('unexpected_crs', False))
        self.assertIsNone(require_crs(g, 'T', expected_epsg=32632))

    def test_invalid_geometries_thresholds(self):
        n = 100
        ok = tracks(n)
        self.assertIsNone(max_invalid_geometries(ok, 'tracks'))
        some = tracks(n, geometry=[None] * 10 + ['P'] * 90)          # 10%: warn
        f = max_invalid_geometries(some, 'tracks')
        self.assertEqual((f.code, f.fatal), ('invalid_geometries', False))
        self.assertIn('10.0%', f.message)
        most = tracks(n, geometry=[None] * 60 + ['P'] * 40)          # 60%: fatal
        self.assertTrue(max_invalid_geometries(most, 'tracks').fatal)
        edge = tracks(n, geometry=[None] * 5 + ['P'] * 95)           # exactly 5%: fine
        self.assertIsNone(max_invalid_geometries(edge, 'tracks'))
        self.assertIsNone(max_invalid_geometries(tracks(0), 'tracks'))
        self.assertIsNone(max_invalid_geometries(pd.DataFrame({'a': [1]}), 'x'))  # no geometry at all

    def test_invalid_geometries_uses_is_empty_and_is_valid_when_present(self):
        class Geo(pd.Series):
            @property
            def _constructor(self):
                return Geo

            @property
            def is_empty(self):
                return pd.Series([False, True, False, False], index=self.index)

            @property
            def is_valid(self):
                return pd.Series([True, True, False, True], index=self.index)

        class Frame(pd.DataFrame):
            @property
            def geometry(self):
                return Geo(self['g'])

        f = max_invalid_geometries(Frame({'g': ['a', 'b', 'c', 'd']}), 'rows', warn_above=0.1, fail_above=None)
        self.assertEqual(f.details['invalid'], 2)   # row 1 empty, row 2 invalid

    def test_null_share_counts_blank_strings(self):
        df = pd.DataFrame({'c': ['a', '', '  ', None, 'b', 'c', 'd', 'e', 'f', 'g']})
        f = max_null_share(df, 'c', 'rows', warn_above=0.1)
        self.assertEqual(f.details['blank'], 3)
        self.assertIsNone(max_null_share(df, 'c', 'rows', warn_above=0.3))   # exactly 30% is not above 30%
        self.assertTrue(max_null_share(df, 'c', 'rows', warn_above=0.1, fail_above=0.2).fatal)
        self.assertIsNone(max_null_share(df, 'nope', 'rows'))
        self.assertIn('3 of 10', max_null_share(df, 'c', 'rows', warn_above=0.1, message='{n} of {total}').message
                      .replace('3 of 10', '3 of 10'))

    def test_null_share_numeric_column(self):
        df = pd.DataFrame({'n': [1.0, np.nan, np.nan, 4.0]})
        self.assertEqual(max_null_share(df, 'n', 'rows', warn_above=0.1).details['blank'], 2)

    def test_duplicate_share(self):
        df = pd.DataFrame({'k': ['a', 'a', 'b', None, None]})
        f = max_duplicate_share(df, 'k', 'rows')
        self.assertEqual(f.details['duplicates'], 1)           # blanks are not counted as duplicates
        self.assertIsNone(max_duplicate_share(pd.DataFrame({'k': ['a', 'b']}), 'k', 'rows'))

    def test_value_share(self):
        df = pd.DataFrame({'flag': ['Invalid'] * 6 + [None] * 4})
        self.assertIsNone(max_value_share(df, 'flag', 'Invalid', 'rows', warn_above=0.6))
        f = max_value_share(df, 'flag', 'Invalid', 'rows', warn_above=0.5, code='bad')
        self.assertEqual((f.code, f.fatal), ('bad', False))
        self.assertIsNone(max_value_share(df, 'flag', 'Invalid', 'rows', warn_above=0.1, min_rows=11))

    def test_row_count_ratio(self):
        self.assertIsNone(row_count_ratio(100, 100, 'out', 'in'))
        self.assertIsNone(row_count_ratio(98, 100, 'out', 'in'))
        f = row_count_ratio(90, 100, 'Result', 'the list')
        self.assertEqual(f.code, 'rows_lost')
        self.assertIn('10 row(s)', f.message)
        self.assertIsNone(row_count_ratio(0, 0, 'out', 'in'))
        self.assertEqual(row_count_ratio(150, 100, 'o', 'i', max_ratio=1.1).code, 'rows_gained')


class ReportBehaviour(unittest.TestCase):
    def test_add_accepts_none_findings_and_iterables(self):
        r = Report('t')
        r.add(None, Finding('a', 'A'), [Finding('b', 'B'), None])
        self.assertEqual([f.code for f in r.findings], ['a', 'b'])

    def test_raise_if_fatal_joins_every_fatal_message(self):
        r = Report('t').add(Finding('one', 'First.', True), Finding('warn', 'Warned.'), Finding('two', 'Second.', True))
        with self.assertRaises(DataContractError) as ctx:
            r.raise_if_fatal()
        exc = ctx.exception
        self.assertEqual((exc.code, exc.message, exc.status_code), ('one', 'First. Second.', 422))
        self.assertEqual([p['code'] for p in exc.details['problems']], ['one', 'two'])

    def test_raise_if_fatal_returns_self_with_only_warnings(self):
        r = Report('t').add(Finding('w', 'Just a warning.'))
        self.assertIs(r.raise_if_fatal(), r)

    def test_headers(self):
        self.assertEqual(Report('t').headers(), {})
        r = Report('t').add(Finding('a', 'One.'), Finding('b', 'Two\nlines'), Finding('f', 'fatal', True))
        self.assertEqual(r.headers(), {WARNING_HEADER: 'a: One.; b: Two lines'})

    def test_header_is_latin1_safe_and_capped(self):
        r = Report('t').add(Finding('a', 'café — ✓ ' + 'x' * 1000))
        value = r.headers()[WARNING_HEADER]
        value.encode('latin-1')
        self.assertLessEqual(len(value), checks.HEADER_MAX_CHARS)
        self.assertTrue(value.endswith('...'))


# ======================================================================
class GtsChecks(unittest.TestCase):
    def test_clean_input_has_no_warnings(self):
        report = gts.validate_input(tracks(), 'CMP')
        self.assertEqual(report.findings, [])

    def test_missing_column_names_the_near_miss(self):
        t = tracks().rename(columns={'Team Code': 'Team code'})
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(t, 'CMP')
        self.assertEqual(ctx.exception.code, 'missing_columns')
        self.assertIn("'Team code' for 'Team Code'", ctx.exception.message)

    def test_no_tracks_left_after_filtering(self):
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(tracks(0), 'CMP')
        self.assertEqual(ctx.exception.code, 'no_valid_tracks')
        self.assertEqual(len(ctx.exception.details['problems']), 1)   # no column noise on an empty table

    def test_blank_activity_code(self):
        for code in (None, '', '   '):
            with self.assertRaises(DataContractError) as ctx:
                gts.validate_input(tracks(), code)
            self.assertEqual(ctx.exception.code, 'missing_activity_code')

    def test_team_code_that_read_as_numbers(self):
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(tracks(Team_Code=None).assign(**{'Team Code': np.nan}), 'CMP')
        self.assertEqual(ctx.exception.code, 'wrong_column_type')

    def test_missing_crs(self):
        t = tracks()
        t.crs = None
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(t, 'CMP')
        self.assertEqual(ctx.exception.code, 'missing_crs')

    def test_many_missing_locations_warns_then_fails(self):
        warn = gts.validate_input(tracks(100, geometry=[None] * 20 + ['P'] * 80), 'CMP')
        self.assertEqual([f.code for f in warn.warnings], ['invalid_geometries'])
        with self.assertRaises(DataContractError):
            gts.validate_input(tracks(100, geometry=[None] * 80 + ['P'] * 20), 'CMP')

    def test_missing_team_codes_warn(self):
        report = gts.validate_input(tracks(20, **{'Team Code': [None] * 5 + ['KN-ABC-DEF1-CMP-001'] * 15}), 'CMP')
        self.assertEqual([f.code for f in report.warnings], ['missing_team_codes'])

    def test_vb_mapping(self):
        ok = pd.DataFrame({'DEVICE ID': ['1'], 'TEAM': ['x']})
        self.assertEqual(gts.validate_input(tracks(), 'CMP', ok).findings, [])
        self.assertEqual(gts.validate_input(tracks(), 'CMP', pd.DataFrame()).findings, [])   # "not supplied"
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(tracks(), 'CMP', pd.DataFrame({'Device': ['1']}))
        self.assertIn('vaccine buddy mapping', ctx.exception.message)

    def test_several_fatal_problems_are_reported_together(self):
        t = tracks().drop(columns=['IMEI'])
        with self.assertRaises(DataContractError) as ctx:
            gts.validate_input(t, '')
        codes = [p['code'] for p in ctx.exception.details['problems']]
        self.assertEqual(codes, ['missing_activity_code', 'missing_columns'])

    def result(self, n=20, flags=None, unique=None):
        return pd.DataFrame({
            'unique_code': unique if unique is not None else ['KN-A'] * n,
            'team_code_flag': flags if flags is not None else [None] * n,
        })

    def test_output_ok(self):
        r = gts.check_output(Report('x'), self.result())
        self.assertEqual(r.findings, [])

    def test_output_warnings(self):
        r = gts.check_output(Report('x'), self.result(20, flags=['Invalid Team Code'] * 10 + [None] * 10))
        self.assertEqual([f.code for f in r.warnings], ['many_invalid_team_codes'])
        r = gts.check_output(Report('x'), self.result(20, unique=[None] * 10 + ['a'] * 10))
        self.assertEqual([f.code for f in r.warnings], ['unmatched_admin_areas'])
        r = gts.check_output(Report('x'), self.result(0))
        self.assertEqual([f.code for f in r.warnings], ['empty_result'])
        # too few rows for a share to mean anything
        r = gts.check_output(Report('x'), self.result(5, flags=['Invalid Team Code'] * 5))
        self.assertEqual(r.findings, [])
        # the warning is what ends up in the response header
        self.assertIn('invalid team code', gts.check_output(
            Report('x'), self.result(20, flags=['Invalid Team Code'] * 20)).headers()[WARNING_HEADER])


# ======================================================================
def admin_finder(mapping):
    """A stand-in for get_admin_col: finds columns by exact lowercase name."""
    def find(data, level):
        return mapping.get(level) if mapping.get(level) in data.columns else None
    return find


def source_frame(state='Kano', n=3, with_geo=True, with_admin=True):
    data = {}
    if with_admin:
        data.update({'state': [state] * n, 'lga': ['l'] * n, 'ward': ['w'] * n, 'settlement': list('abc')[:n]})
    if with_geo:
        data.update({'lat': [1.0] * n, 'lon': [2.0] * n})
    return pd.DataFrame(data)


def geo_finder(data):
    lowered = {str(c).lower() for c in data.columns}
    if not {'lat', 'lon'} <= lowered:
        raise KeyError('no coordinates')
    return ('lat', 'lon')


ADMIN = admin_finder({'state': 'state', 'lga': 'lga', 'ward': 'ward', 'settlement': 'settlement'})


def settlements(n=30):
    return pd.DataFrame({'uniquecode': [f'Kano_L_W_S{i}' for i in range(n)], 'state': ['Kano'] * n})


def validate(sources, planned=None, coords=True, settlement=True, **kw):
    return reach.validate_input(
        planned if planned is not None else settlements(), sources, unique_code='uniquecode', state_names=['Kano'],
        use_coords=coords, use_settlement=settlement, find_admin_col=ADMIN, find_geom_cols=geo_finder, **kw)


class ReachStates(unittest.TestCase):
    def test_valid_states_in_order_with_cleanup(self):
        out = reach.resolve_states(pd.Series([' kano ', 'KANO', 'Kaduna']), FakeState)
        self.assertEqual(out, [FakeState.Kano, FakeState.Kaduna])

    def test_unknown_state(self):
        with self.assertRaises(DataContractError) as ctx:
            reach.resolve_states(pd.Series(['Kano', 'Kanoo']), FakeState)
        exc = ctx.exception
        self.assertEqual(exc.code, 'unknown_states')
        self.assertEqual(exc.details['unknown'], ['Kanoo'])
        self.assertEqual(exc.details['valid_examples'], ['Kano', 'Kaduna', 'Borno'])

    def test_blank_and_numeric_state(self):
        with self.assertRaises(DataContractError) as ctx:
            reach.resolve_states(pd.Series(['Kano', None]), FakeState)
        self.assertEqual((ctx.exception.code, ctx.exception.details['rows_without_state']), ('missing_state_values', 1))
        with self.assertRaises(DataContractError) as ctx:
            reach.resolve_states(pd.Series([1, 2]), FakeState)
        self.assertEqual(ctx.exception.code, 'state_not_text')


class ReachInput(unittest.TestCase):
    def test_clean(self):
        report = validate({'Fionet': source_frame(), 'GTS': tracks()})
        self.assertEqual(report.findings, [])

    def test_gts_dataset_is_not_checked_for_admin_columns(self):
        report = validate({'GTS': pd.DataFrame({'lat': [1.0], 'lon': [2.0]})})
        self.assertEqual(report.findings, [])

    def test_source_missing_admin_columns_is_fatal_and_names_the_levels(self):
        with self.assertRaises(DataContractError) as ctx:
            validate({'Fionet': source_frame(), 'Bad': source_frame().drop(columns=['ward', 'lga'])})
        exc = ctx.exception
        self.assertEqual(exc.code, 'source_missing_admin_columns')
        self.assertIn("'Bad' has no lga, ward column", exc.message)

    def test_source_outside_planned_state_is_fatal(self):
        with self.assertRaises(DataContractError) as ctx:
            validate({'Fionet': source_frame('Lagos')})
        self.assertEqual(ctx.exception.code, 'source_outside_area')
        self.assertIn('Fionet', ctx.exception.message)

    def test_state_matching_ignores_case_and_spaces(self):
        self.assertEqual(validate({'Fionet': source_frame('  KANO ')}).findings, [])

    def test_admin_checks_skipped_for_coordinate_only_runs(self):
        report = validate({'Fionet': source_frame(with_admin=False)}, settlement=False)
        self.assertEqual(report.findings, [])

    def test_some_sources_without_coordinates_warn(self):
        report = validate({'A': source_frame(), 'B': source_frame(with_geo=False)})
        self.assertEqual([(f.code, f.fatal) for f in report.findings], [('sources_without_coordinates', False)])
        self.assertEqual(report.findings[0].details['sources'], ['B'])

    def test_coordinate_only_run_where_no_source_has_coordinates_is_fatal(self):
        with self.assertRaises(DataContractError) as ctx:
            validate({'A': source_frame(with_geo=False)}, settlement=False)
        self.assertEqual(ctx.exception.code, 'no_usable_coordinates')

    def test_missing_coordinates_only_warn_when_the_other_method_can_still_work(self):
        report = validate({'A': source_frame(with_geo=False)})
        self.assertEqual(report.findings[0].code, 'sources_without_coordinates')

    def test_empty_source(self):
        with self.assertRaises(DataContractError) as ctx:       # the settlement method would crash in pd.concat
            validate({'A': source_frame().iloc[0:0]})
        self.assertEqual(ctx.exception.code, 'empty_source')
        report = validate({'A': source_frame().iloc[0:0], 'B': source_frame()}, settlement=False)
        self.assertEqual([(f.code, f.fatal) for f in report.findings], [('empty_source', False)])

    def test_no_sources(self):
        with self.assertRaises(DataContractError) as ctx:
            validate({})
        self.assertEqual(ctx.exception.code, 'no_data_sources')

    def test_empty_settlement_list(self):
        with self.assertRaises(DataContractError) as ctx:
            validate({'A': source_frame()}, planned=settlements(0))
        self.assertEqual(ctx.exception.code, 'empty_dataset')

    def test_incomplete_and_duplicate_settlement_names_warn(self):
        planned = settlements(10)
        planned.loc[0, 'uniquecode'] = np.nan
        planned.loc[1, 'uniquecode'] = np.nan
        planned.loc[3, 'uniquecode'] = planned.loc[2, 'uniquecode']
        report = validate({'A': source_frame()}, planned=planned)
        by_code = {f.code: f for f in report.warnings}
        self.assertEqual(set(by_code), {'incomplete_settlement_names', 'duplicate_settlement_codes'})
        self.assertEqual(by_code['incomplete_settlement_names'].details['blank'], 2)
        self.assertEqual(by_code['duplicate_settlement_codes'].details['duplicates'], 1)

    def test_an_admin_finder_that_raises_counts_as_not_found(self):
        def boom(data, level):
            raise RuntimeError('fuzzy matcher blew up')
        with self.assertRaises(DataContractError) as ctx:
            reach.validate_input(settlements(), {'A': source_frame()}, unique_code='uniquecode', state_names=['Kano'],
                                 use_coords=False, use_settlement=True, find_admin_col=boom, find_geom_cols=geo_finder)
        self.assertEqual(ctx.exception.code, 'source_missing_admin_columns')


class ReachOutput(unittest.TestCase):
    def result(self, n=30, visited=None, sources=None):
        visited = n if visited is None else visited
        return pd.DataFrame({
            'uniquecode': [f's{i}' for i in range(n)],
            'status': ['Visited'] * visited + ['Not Visited'] * (n - visited),
            'sources': sources if sources is not None else ['A | B'] * visited + [None] * (n - visited),
        })

    def test_healthy(self):
        r = reach.check_output(Report('x'), self.result(visited=10), 30, ['A', 'B'])
        self.assertEqual(r.findings, [])

    def test_nothing_reached(self):
        r = reach.check_output(Report('x'), self.result(30, visited=0), 30, ['A', 'B'])
        self.assertEqual([f.code for f in r.warnings], ['nothing_reached'])
        # ...and the per-source finding stays quiet when nothing matched at all
        small = reach.check_output(Report('x'), self.result(5, visited=0), 5, ['A'])
        self.assertEqual(small.findings, [])

    def test_a_source_that_matched_nothing(self):
        r = reach.check_output(Report('x'), self.result(visited=10), 30, ['A', 'B', 'C', 'D'])
        self.assertEqual(r.findings[0].code, 'source_matched_nothing')
        self.assertEqual(r.findings[0].details['sources'], ['C', 'D'])

    def test_source_names_are_matched_exactly_not_as_substrings(self):
        r = reach.check_output(Report('x'), self.result(visited=10, sources=['GTS2 | A'] * 10 + [None] * 20), 30, ['GTS', 'A', 'GTS2'])
        self.assertEqual(r.findings[0].details['sources'], ['GTS'])

    def test_rows_lost(self):
        r = reach.check_output(Report('x'), self.result(25, visited=5), 30, ['A', 'B'])
        self.assertEqual([f.code for f in r.warnings], ['rows_lost'])

    def test_empty_result_and_missing_sources_column(self):
        r = reach.check_output(Report('x'), self.result(0), 0, ['A'])
        self.assertEqual([f.code for f in r.warnings], ['empty_result'])
        no_col = self.result(30, visited=10).drop(columns=['sources'])
        self.assertEqual(reach.check_output(Report('x'), no_col, 30, ['A']).findings, [])


# ======================================================================
class JobRowPlumbing(unittest.TestCase):
    """The warning travels: tool header -> middleware -> jobs.data_warning -> /jobs."""

    def run_app(self, handler, **kw):
        sent, raised = asyncio.run(asgi_call(make_app(handler), **kw))
        return sent, raised

    def test_column_exists_and_is_in_job_listing(self):
        self.assertIn('data_warning', {r['name'] for r in rows('PRAGMA table_info(jobs)')})
        self.assertIn('data_warning', store.get_recent(1)[0] if store.get_recent(1) else {'data_warning': 1})

    def test_warning_header_is_saved_on_a_completed_job_and_still_reaches_the_client(self):
        async def handler(request):
            return PlainTextResponse('csv', headers=Report('t').add(Finding('nothing_reached', 'No match.')).headers())
        sent, raised = self.run_app(handler)
        self.assertIsNone(raised)
        start = sent[0]
        self.assertIn((b'x-data-warning', b'nothing_reached: No match.'), start['headers'])
        job = latest_job()
        self.assertEqual((job['status'], job['data_warning']), ('completed', 'nothing_reached: No match.'))
        self.assertEqual(store.get_recent(1)[0]['data_warning'], 'nothing_reached: No match.')

    def test_no_header_means_no_warning(self):
        async def handler(request):
            return PlainTextResponse('csv')
        self.run_app(handler)
        self.assertIsNone(latest_job()['data_warning'])

    def test_long_warning_is_trimmed_for_storage(self):
        async def handler(request):
            return PlainTextResponse('csv', headers={'X-Data-Warning': 'w' * 900})
        self.run_app(handler)
        self.assertEqual(len(latest_job()['data_warning']), store.DATA_WARNING_LIMIT)

    def test_a_warning_does_not_make_the_job_a_failure(self):
        async def handler(request):
            return PlainTextResponse('csv', headers={'X-Data-Warning': 'x: y'})
        before = store.get_stats('30d')['overall']
        self.run_app(handler)
        job = latest_job()
        self.assertEqual((job['status'], job['error_category']), ('completed', None))
        after = store.get_stats('30d')['overall']
        self.assertEqual(after['failed_counted'], before['failed_counted'])
        self.assertEqual(after['completed'], before['completed'] + 1)

    def test_fatal_findings_file_as_data_contract_with_the_check_code(self):
        async def handler(request):
            Report('gts_device_tracking').add(Finding('missing_columns', 'Missing.', True)).raise_if_fatal()
        sent, raised = self.run_app(handler)
        self.assertIsNone(raised)
        self.assertEqual(sent[0]['status'], 422)
        job = latest_job()
        self.assertEqual((job['status'], job['error_category'], job['error_type']), ('failed', 'data_contract', 'missing_columns'))


if __name__ == '__main__':
    unittest.main()
