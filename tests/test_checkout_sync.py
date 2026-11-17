"""The checkout sync (mlos/planfeld/checkout_mgr/sync_db.py): updating the settlements view of a versioned
checkout from the MLoS.

The checkout is a versioned SQLite database. Its settlements VIEW is the only thing written to: INSTEAD OF
triggers turn an UPDATE, INSERT or DELETE on the view into a new version of a row in the history table. These
tests build such a database and check that records are updated, inserted and deleted through the view, that the
three changes are saved together or not at all, and that nothing is written to the base table directly.

SpatiaLite is not available where these tests run, so spatialite_version() and ST_GeomFromText() are small
stand-ins registered on the connection; the SQL around them is exactly what runs against the real extension.

Run from the repo root:  python -m unittest tests.test_checkout_sync -v
"""
import asyncio
import io
import os
import sqlite3
import tempfile
import types
import unittest
from datetime import datetime
from unittest import mock
from uuid import UUID

import numpy as np
import pandas as pd

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_h7_readers import load, stand_in, exceptions_module

VIEW = 'master_list_settlement_update_view'
HISTORY = 'settlement_history'


class Point:
    def __init__(self, x, y):
        self.x, self.y, self.is_empty = x, y, False

    @property
    def wkt(self):
        return f'POINT ({self.x} {self.y})'


class Empty:
    wkt, is_empty = 'GEOMETRYCOLLECTION EMPTY', True


def stubs():
    anything = mock.MagicMock()
    return {
        'geopandas': stand_in('geopandas', GeoDataFrame=pd.DataFrame),
        'fastapi': stand_in('fastapi', UploadFile=object, BackgroundTasks=object),
        'toolbox.configs': stand_in('toolbox.configs', CONFIG={'DATASETS': {
            'db_settlements': VIEW, 'db_takeoff_points': 'mlos_takeoffpoint_view'}}),
        'toolbox.access.read_mgr': stand_in('toolbox.access.read_mgr', read_dataset=anything),
        'toolbox.access': stand_in('toolbox.access', ReadDBData=anything),
        'toolbox.exceptions': exceptions_module(),
        'toolbox.mlos.planfeld.checkout_mgr.tools': stand_in(
            'toolbox.mlos.planfeld.checkout_mgr.tools', enrich_admin_codes=anything,
            get_updated_records=anything, update_settlements=anything),
        'toolbox.mlos.validation.review.run_validate': stand_in(
            'toolbox.mlos.validation.review.run_validate', run_settlements_qc=anything),
        'toolbox.mlos.planfeld.checkout_mgr.prep': stand_in(
            'toolbox.mlos.planfeld.checkout_mgr.prep', validate_settlements_takeoff_points=anything,
            populate_editors=anything),
        'toolbox.mlos.validation.review.summarize': stand_in(
            'toolbox.mlos.validation.review.summarize', categorize_flags=anything, major_flag_check=anything),
        'toolbox.mlos': stand_in(
            'toolbox.mlos', detect_unique_admin_field=anything, construct_new_unique=anything, get_admin_col=anything),
    }


sync = load('mlos/planfeld/checkout_mgr/sync_db.py', stubs())


def register_spatialite_stand_ins(conn):
    conn.create_function('spatialite_version', 0, lambda: '5.0.1-stand-in')
    conn.create_function('ST_GeomFromText', 2, lambda wkt, srid: None if wkt is None else f'{srid}|{wkt}')


def make_checkout(path, versioned=True, guard=None, geom_name='geometry', metadata=False):
    """A versioned checkout: history table + the 'current rows' view + INSTEAD OF triggers on the view."""
    conn = sqlite3.connect(path)
    conn.executescript(f'''
        CREATE TABLE {HISTORY} (
            fid INTEGER PRIMARY KEY AUTOINCREMENT, eha_guid TEXT, settlement_name TEXT, population REAL, latitude REAL,
            geometry TEXT, last_updated TEXT, is_current INTEGER DEFAULT 1, version INTEGER DEFAULT 1);
        CREATE INDEX history_guid ON {HISTORY} (eha_guid);
        CREATE VIEW {VIEW} AS
            SELECT eha_guid, settlement_name, population, latitude, geometry AS {geom_name}, last_updated, version
            FROM {HISTORY} WHERE is_current = 1;
    ''')
    if versioned:
        conn.executescript(f'''
            CREATE TRIGGER view_update INSTEAD OF UPDATE ON {VIEW}
            BEGIN
                {guard or ''}
                UPDATE {HISTORY} SET is_current = 0 WHERE eha_guid = OLD.eha_guid AND is_current = 1;
                INSERT INTO {HISTORY} (eha_guid, settlement_name, population, latitude, geometry, last_updated, version)
                VALUES (NEW.eha_guid, NEW.settlement_name, NEW.population, NEW.latitude, NEW.{geom_name}, NEW.last_updated,
                        OLD.version + 1);
            END;
            CREATE TRIGGER view_insert INSTEAD OF INSERT ON {VIEW}
            BEGIN
                INSERT INTO {HISTORY} (eha_guid, settlement_name, population, latitude, geometry, last_updated)
                VALUES (NEW.eha_guid, NEW.settlement_name, NEW.population, NEW.latitude, NEW.{geom_name}, NEW.last_updated);
            END;
            CREATE TRIGGER view_delete INSTEAD OF DELETE ON {VIEW}
            BEGIN
                UPDATE {HISTORY} SET is_current = 0 WHERE eha_guid = OLD.eha_guid AND is_current = 1;
            END;
        ''')
    if metadata:  # what SpatiaLite keeps about a view's geometry column
        conn.executescript(f'''
            CREATE TABLE views_geometry_columns (view_name TEXT, view_geometry TEXT, view_rowid TEXT,
                f_table_name TEXT, f_geometry_column TEXT, read_only INTEGER);
            INSERT INTO views_geometry_columns VALUES ('{VIEW}', '{geom_name}', 'fid', '{HISTORY}', 'geometry', 0);
        ''')
    conn.commit()
    conn.close()


def seed(path, rows):
    conn = sqlite3.connect(path)
    conn.executemany(
        f'INSERT INTO {HISTORY} (eha_guid, settlement_name, population, geometry) VALUES (?, ?, ?, ?)', rows)
    conn.commit()
    conn.close()


def view_rows(path, geom='geometry'):
    conn = sqlite3.connect(path)
    try:
        return {r[0]: r[1:] for r in conn.execute(
            f'SELECT eha_guid, settlement_name, population, {geom}, version FROM {VIEW}')}
    finally:
        conn.close()


def history_rows(path, guid):
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            f'SELECT settlement_name, is_current, version FROM {HISTORY} WHERE eha_guid = ? ORDER BY fid',
            (guid,)).fetchall()
    finally:
        conn.close()


def records(rows, geometries=None):
    frame = pd.DataFrame(rows, columns=['eha_guid', 'settlement_name', 'population'])
    if geometries is not None:
        frame['geometry'] = geometries
    return frame


def run(coro):
    return asyncio.run(coro)


class CheckoutTestCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, 'checkout.sqlite')
        patcher = mock.patch.object(sync, 'load_spatialite_extension', register_spatialite_stand_ins)
        patcher.start()
        self.addCleanup(patcher.stop)

    def checkout(self, **kwargs):
        make_checkout(self.path, **kwargs)
        return types.SimpleNamespace(checkout_file=self.path, settlement_table=VIEW)

    def apply(self, changed=None, new=None, drop=None):
        return sync.apply_checkout_changes(self.path, VIEW, changed, new, drop)


class TestSpatialiteCheck(unittest.TestCase):
    def fake_conn(self, fail_on=None):
        conn = mock.MagicMock()
        executed = []

        def execute(sql, *a):
            executed.append(sql)
            if fail_on and fail_on in sql:
                raise sqlite3.OperationalError(f'no such function: {fail_on}')
            return mock.MagicMock()
        conn.execute.side_effect = execute
        conn.executed = executed
        return conn

    def test_checks_spatialite_version_not_the_nonexistent_hasgeospa(self):
        conn = self.fake_conn()
        sync.load_spatialite_extension(conn)
        self.assertTrue(any('spatialite_version' in s for s in conn.executed))
        self.assertFalse(any('HasGeoSpa' in s for s in conn.executed))
        conn.cursor.assert_not_called()

    def test_a_loaded_extension_without_its_functions_is_a_clear_error(self):
        with self.assertRaisesRegex(RuntimeError, 'SQL functions are not available'):
            sync.load_spatialite_extension(self.fake_conn(fail_on='spatialite_version'))

    def test_no_extension_found_is_a_clear_error(self):
        conn = self.fake_conn()
        conn.load_extension.side_effect = sqlite3.OperationalError('not found')
        with self.assertRaisesRegex(RuntimeError, 'Could not load mod_spatialite'):
            sync.load_spatialite_extension(conn)


class TestUpdate(CheckoutTestCase):
    def test_update_makes_a_new_version_and_keeps_the_history(self):
        self.checkout()
        seed(self.path, [('g1', 'Old Name', 1.0, 'g'), ('g2', 'Untouched', 2.0, 'g')])
        self.apply(changed=records([('g1', 'New Name', 1.5)]))
        self.assertEqual(view_rows(self.path)['g1'][0:2], ('New Name', 1.5))
        self.assertEqual(view_rows(self.path)['g1'][3], 2)
        self.assertEqual(history_rows(self.path, 'g1'), [('Old Name', 0, 1), ('New Name', 1, 2)])
        self.assertEqual(history_rows(self.path, 'g2'), [('Untouched', 1, 1)])

    def test_update_returns_how_many_records_matched(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        counts = self.apply(changed=records([('g1', 'B', 1.0), ('unknown', 'C', 1.0)]))
        self.assertEqual(counts['updated'], 1)
        self.assertNotIn('unknown', view_rows(self.path))

    def test_geometry_latitude_and_longitude_are_updated_like_any_other_attribute(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'old geometry')])
        frame = records([('g1', 'A2', 2.0)], [Point(7, 8)])
        frame['latitude'] = 1.25
        self.apply(changed=frame)
        rows = view_rows(self.path)
        self.assertEqual(rows['g1'][0:3], ('A2', 2.0, '4326|POINT (7 8)'))
        conn = sqlite3.connect(self.path)
        self.assertEqual(conn.execute(f'SELECT latitude FROM {VIEW}').fetchone()[0], 1.25)
        conn.close()

    def test_a_record_with_no_geometry_keeps_the_geometry_it_has(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'kept'), ('g2', 'B', 1.0, 'kept2')])
        self.apply(changed=records([('g1', 'A2', 1.0), ('g2', 'B2', 1.0)], [Empty(), float('nan')]))
        rows = view_rows(self.path)
        self.assertEqual((rows['g1'][0], rows['g1'][2]), ('A2', 'kept'))
        self.assertEqual((rows['g2'][0], rows['g2'][2]), ('B2', 'kept2'))

    def test_geometry_is_updated_when_the_database_calls_the_column_geom(self):
        """The records always say 'geometry'; the view may not. Found from SpatiaLite's own metadata."""
        self.checkout(geom_name='geom', metadata=True)
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        self.apply(changed=records([('g1', 'A2', 1.0)], [Point(3, 4)]))
        self.assertEqual(view_rows(self.path, geom='geom')['g1'][2], '4326|POINT (3 4)')

    def test_the_geometry_column_is_found_by_name_when_there_is_no_metadata(self):
        self.checkout(geom_name='geom')
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        self.apply(changed=records([('g1', 'A2', 1.0)], [Point(3, 4)]))
        self.assertEqual(view_rows(self.path, geom='geom')['g1'][2], '4326|POINT (3 4)')

    def test_a_view_with_an_unrecognised_geometry_column_is_updated_without_it_and_says_so(self):
        self.checkout(geom_name='footprint')
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        with self.assertLogs(sync.logger, 'WARNING') as logged:
            self.apply(changed=records([('g1', 'A2', 1.0)], [Point(3, 4)]))
        self.assertTrue(any('no geometry column' in line for line in logged.output))
        rows = view_rows(self.path, geom='footprint')
        self.assertEqual((rows['g1'][0], rows['g1'][2]), ('A2', 'old'))

    def test_geometry_is_found_without_an_active_geometry_column(self):
        """A merge or concat drops a GeoDataFrame's active geometry; the shapely column is still found."""
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        frame = pd.DataFrame({'eha_guid': ['g1'], 'settlement_name': ['A2'], 'shape_data': [Point(5, 6)]})
        self.apply(changed=frame)
        self.assertEqual(view_rows(self.path)['g1'][2], '4326|POINT (5 6)')

    def test_a_geometry_column_called_geom_does_not_clash_with_the_staging_column(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        frame = pd.DataFrame({'eha_guid': ['g1'], 'settlement_name': ['A2'], 'geom': [Point(1, 1)]})
        self.apply(changed=frame)
        self.assertEqual(view_rows(self.path)['g1'][2], '4326|POINT (1 1)')

    def test_geometry_given_as_wkt_text_is_accepted(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'old')])
        self.apply(changed=records([('g1', 'A2', 1.0)], ['POINT (9 9)']))
        self.assertEqual(view_rows(self.path)['g1'][2], '4326|POINT (9 9)')

    def test_columns_the_view_does_not_have_are_ignored(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        frame = records([('g1', 'B', 1.0)])
        frame['editor_notes'] = 'not in the view'
        with self.assertLogs(sync.logger, 'WARNING') as logged:
            self.apply(changed=frame)
        self.assertIn('editor_notes', logged.output[0])
        self.assertEqual(view_rows(self.path)['g1'][0], 'B')

    def test_values_numpy_nan_and_timestamps_are_accepted(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g')])
        frame = pd.DataFrame({
            'eha_guid': ['g1', 'g2'], 'settlement_name': [np.str_('Numpy name'), None],
            'population': [np.float64(3.25), np.nan],
            'last_updated': [pd.Timestamp('2026-03-04 05:06:07'), pd.NaT]})
        self.apply(changed=frame)
        rows = view_rows(self.path)
        self.assertEqual(rows['g1'][0:2], ('Numpy name', 3.25))
        self.assertEqual(rows['g2'][0:2], (None, None))
        conn = sqlite3.connect(self.path)
        stamps = dict(conn.execute(f'SELECT eha_guid, last_updated FROM {VIEW}'))
        conn.close()
        self.assertEqual(stamps, {'g1': '2026-03-04 05:06:07', 'g2': None})

    def test_a_repeated_guid_is_applied_once_with_the_last_values(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        with self.assertLogs(sync.logger, 'WARNING'):
            self.apply(changed=records([('g1', 'first', 1.0), ('g1', 'last', 1.0)]))
        self.assertEqual(history_rows(self.path, 'g1'), [('A', 0, 1), ('last', 1, 2)])

    def test_the_staging_table_is_never_left_in_the_checkout_file(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        self.apply(changed=records([('g1', 'B', 1.0)]), new=records([('g9', 'N', 1.0)]), drop=['g1'])
        conn = sqlite3.connect(self.path)
        names = {r[0] for r in conn.execute('SELECT name FROM sqlite_master')}
        conn.close()
        self.assertEqual(names & {'temp_staging', 'temp_staging_update', 'temp_staging_new', 'temp_drop_ids'}, set())


class TestInsert(CheckoutTestCase):
    def test_new_records_are_inserted_through_the_view(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        counts = self.apply(new=records([('n1', 'New One', 5.0), ('n2', 'New Two', 6.0)], [Point(1, 2), Point(3, 4)]))
        self.assertEqual(counts['inserted'], 2)
        rows = view_rows(self.path)
        self.assertEqual(rows['n1'][0:3], ('New One', 5.0, '4326|POINT (1 2)'))
        self.assertEqual(rows['n2'][2], '4326|POINT (3 4)')
        self.assertEqual(set(rows), {'g1', 'n1', 'n2'})

    def test_new_records_get_their_geometry_and_coordinates(self):
        self.checkout(geom_name='geom', metadata=True)
        frame = records([('n1', 'New', 1.0)], [Point(1, 2)])
        frame['latitude'] = 2.0
        self.apply(new=frame)
        self.assertEqual(view_rows(self.path, geom='geom')['n1'][2], '4326|POINT (1 2)')
        conn = sqlite3.connect(self.path)
        self.assertEqual(conn.execute(f"SELECT latitude FROM {VIEW} WHERE eha_guid='n1'").fetchone()[0], 2.0)
        conn.close()

    def test_a_guid_already_in_the_view_is_not_duplicated(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        with self.assertLogs(sync.logger, 'WARNING'):
            counts = self.apply(new=records([('g1', 'Dup', 1.0), ('n1', 'New', 1.0)]))
        self.assertEqual(counts['inserted'], 1)
        self.assertEqual(history_rows(self.path, 'g1'), [('A', 1, 1)])

    def test_a_new_record_without_a_guid_is_refused_and_nothing_is_saved(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        with self.assertRaises(Exception) as caught:
            self.apply(changed=records([('g1', 'B', 1.0)]), new=records([(None, 'No guid', 1.0)]))
        self.assertIn("have no 'eha_guid'", caught.exception.details)
        self.assertEqual(view_rows(self.path)['g1'][0], 'A')

    def test_a_view_that_swallows_inserts_is_an_error_and_rolls_back(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        conn = sqlite3.connect(self.path)
        conn.execute('DROP TRIGGER view_insert')
        conn.execute(f'CREATE TRIGGER view_insert INSTEAD OF INSERT ON {VIEW} BEGIN SELECT 1; END')
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(RuntimeError, 'were not added'):
            self.apply(changed=records([('g1', 'B', 1.0)]), new=records([('n1', 'New', 1.0)]))
        self.assertEqual(view_rows(self.path)['g1'][0], 'A')

    def test_a_view_without_an_insert_trigger_gives_sqlite_error_and_rolls_back(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        conn = sqlite3.connect(self.path)
        conn.execute('DROP TRIGGER view_insert')
        conn.commit()
        conn.close()
        with self.assertRaises(sqlite3.OperationalError):
            self.apply(changed=records([('g1', 'B', 1.0)]), new=records([('n1', 'New', 1.0)]))
        self.assertEqual(view_rows(self.path)['g1'][0], 'A')


class TestDelete(CheckoutTestCase):
    def test_dropped_records_are_deleted_through_the_view(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g')])
        counts = self.apply(drop=['g1'])
        self.assertEqual(counts['deleted'], 1)
        self.assertEqual(set(view_rows(self.path)), {'g2'})
        self.assertEqual(history_rows(self.path, 'g1'), [('A', 0, 1)])  # the history is kept

    def test_tens_of_thousands_of_ids_do_not_hit_the_sql_variable_limit(self):
        self.checkout()
        total = 40000
        seed(self.path, [(f'g{i}', 'x', 1.0, 'g') for i in range(total)])
        counts = self.apply(drop=[f'g{i}' for i in range(total - 1)])
        self.assertEqual(counts['deleted'], total - 1)
        self.assertEqual(set(view_rows(self.path)), {f'g{total - 1}'})

    def test_ids_that_are_not_in_the_view_are_skipped(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        with self.assertLogs(sync.logger, 'WARNING'):
            counts = self.apply(drop=['g1', 'nope', None, 'g1', float('nan')])
        self.assertEqual(counts['deleted'], 1)

    def test_a_view_that_swallows_deletes_is_an_error_and_rolls_back(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        conn = sqlite3.connect(self.path)
        conn.execute('DROP TRIGGER view_delete')
        conn.execute(f'CREATE TRIGGER view_delete INSTEAD OF DELETE ON {VIEW} BEGIN SELECT 1; END')
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(RuntimeError, 'were not deleted'):
            self.apply(changed=records([('g1', 'B', 1.0)]), drop=['g1'])
        self.assertEqual(view_rows(self.path)['g1'][0], 'A')

    def test_no_ids_deletes_nothing(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        self.assertEqual(self.apply(drop=[])['deleted'], 0)
        self.assertEqual(self.apply(drop=None)['deleted'], 0)
        self.assertEqual(set(view_rows(self.path)), {'g1'})


class TestTogether(CheckoutTestCase):
    def test_update_insert_and_delete_in_one_run(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g'), ('g3', 'C', 1.0, 'g')])
        counts = self.apply(
            changed=records([('g1', 'A updated', 1.0)]), new=records([('n1', 'New', 1.0)]), drop=['g3'])
        self.assertEqual(counts, {'updated': 1, 'inserted': 1, 'deleted': 1})
        rows = view_rows(self.path)
        self.assertEqual({k: v[0] for k, v in rows.items()}, {'g1': 'A updated', 'g2': 'B', 'n1': 'New'})

    def test_a_failure_part_way_saves_nothing(self):
        guard = "SELECT RAISE(ABORT, 'not allowed') WHERE NEW.settlement_name = 'boom';"
        self.checkout(guard=guard)
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g')])
        with self.assertRaisesRegex(sqlite3.Error, 'not allowed'):
            self.apply(changed=records([('g1', 'fine', 1.0), ('g2', 'boom', 1.0)]),
                       new=records([('n1', 'New', 1.0)]), drop=['g1'])
        self.assertEqual({k: v[0] for k, v in view_rows(self.path).items()}, {'g1': 'A', 'g2': 'B'})

    def test_a_failure_before_the_transaction_starts_is_not_swallowed(self):
        """E.g. SpatiaLite cannot be loaded: that must reach the caller, not look like a successful run."""
        self.checkout()
        with mock.patch.object(sync, 'load_spatialite_extension', side_effect=RuntimeError('no spatialite')):
            with self.assertRaisesRegex(RuntimeError, 'no spatialite'):
                self.apply(changed=records([('g1', 'B', 1.0)]))

    def test_the_connection_is_closed_after_a_failure(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        opened = []
        real = sqlite3.connect

        def spy(*a, **k):
            conn = real(*a, **k)
            opened.append(conn)
            return conn
        with mock.patch.object(sqlite3, 'connect', spy):
            with self.assertRaises(Exception):
                self.apply(new=records([(None, 'bad', 1.0)]))
        self.assertEqual(len(opened), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            opened[0].execute('SELECT 1')
        os.remove(self.path)  # not held open (matters on Windows)

    def test_the_base_table_is_only_changed_by_the_views_triggers(self):
        """No statement is ever run against the history table by name."""
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        statements = []
        real = sqlite3.connect

        def traced(*a, **k):
            conn = real(*a, **k)
            conn.set_trace_callback(statements.append)
            return conn
        with mock.patch.object(sqlite3, 'connect', traced):
            self.apply(changed=records([('g1', 'B', 1.0)]), new=records([('n1', 'N', 1.0)]), drop=['g1'])
        # the INSTEAD OF triggers' own statements are traced too (prefixed '-- TRIGGER'); skip those
        direct = [s for s in statements if HISTORY in s and not s.startswith('-- TRIGGER')]
        self.assertEqual(direct, [])


class TestUpdateMlosCheckout(CheckoutTestCase):
    def test_a_path_checkout_is_changed_in_place(self):
        checkout = self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g')])
        out = run(sync.update_mlos_checkout(
            checkout, records([('g1', 'A2', 1.0)]), drop_ids=['g2'], new_records=records([('n1', 'N', 1.0)])))
        self.assertEqual(out, self.path)
        self.assertEqual({k: v[0] for k, v in view_rows(self.path).items()}, {'g1': 'A2', 'n1': 'N'})

    def test_an_uploaded_checkout_leaves_the_original_alone_and_the_copy_is_cleaned_up(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        upload = types.SimpleNamespace(file=open(self.path, 'rb'))
        self.addCleanup(upload.file.close)
        checkout = types.SimpleNamespace(checkout_file=upload, settlement_table=VIEW)
        tasks = mock.MagicMock()
        out = run(sync.update_mlos_checkout(checkout, records([('g1', 'A2', 1.0)]), background_tasks=tasks))
        self.assertNotEqual(out, self.path)
        self.assertTrue(out.endswith('.sqlite'))
        self.addCleanup(lambda: os.path.exists(out) and os.remove(out))
        self.assertEqual(view_rows(out)['g1'][0], 'A2')
        self.assertEqual(view_rows(self.path)['g1'][0], 'A')
        tasks.add_task.assert_called_once_with(sync.cleanup_file, out)

    def test_totals_count_what_the_checkout_holds_afterwards(self):
        checkout = self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g'), ('g2', 'B', 1.0, 'g')])
        conn = sqlite3.connect(self.path)
        conn.execute('CREATE TABLE tko (id INTEGER)')
        conn.executemany('INSERT INTO tko VALUES (?)', [(1,), (2,), (3,)])
        conn.commit()
        conn.close()
        checkout.takeoff_table = 'tko'
        path, counts = run(sync.apply_mlos_checkout(
            checkout, None, drop_ids=['g2'], new_records=records([('n1', 'N', 1.0), ('n2', 'M', 1.0)]),
            with_totals=True))
        self.assertEqual(counts, {'updated': 0, 'inserted': 2, 'deleted': 1, 'settlements_after': 3, 'takeoff_checkout': 3})

    def test_a_missing_takeoff_table_counts_as_unknown_not_an_error(self):
        checkout = self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        checkout.takeoff_table = 'no_such_view'
        _, counts = run(sync.apply_mlos_checkout(checkout, records([('g1', 'B', 1.0)]), with_totals=True))
        self.assertEqual((counts['settlements_after'], counts['takeoff_checkout']), (1, None))

    def test_an_upload_that_was_already_read_is_copied_from_the_start(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        upload = types.SimpleNamespace(file=open(self.path, 'rb'))
        self.addCleanup(upload.file.close)
        upload.file.read()  # e.g. read_dataset() already loaded its tables from it
        checkout = types.SimpleNamespace(checkout_file=upload, settlement_table=VIEW)
        out = run(sync.update_mlos_checkout(checkout, records([('g1', 'A2', 1.0)])))
        self.addCleanup(lambda: os.path.exists(out) and os.remove(out))
        self.assertEqual(view_rows(out)['g1'][0], 'A2')

    def test_a_failed_upload_leaves_no_temporary_copy(self):
        self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        upload = types.SimpleNamespace(file=open(self.path, 'rb'))
        self.addCleanup(upload.file.close)
        checkout = types.SimpleNamespace(checkout_file=upload, settlement_table=VIEW)
        created = []
        real = tempfile.NamedTemporaryFile

        def spy(*a, **k):
            tmp = real(*a, **k)
            created.append(tmp.name)
            return tmp
        with mock.patch.object(sync.tempfile, 'NamedTemporaryFile', spy):
            with self.assertRaises(Exception):
                run(sync.update_mlos_checkout(checkout, records([('g1', 'A2', 1.0)]), new_records=records([(None, 'x', 1.0)])))
        self.assertEqual(len(created), 1)
        self.assertFalse(os.path.exists(created[0]))

    def test_a_checkout_without_the_view_is_a_clear_input_error(self):
        make_checkout(self.path)
        checkout = types.SimpleNamespace(checkout_file=self.path, settlement_table='no_such_view')
        with self.assertRaises(Exception) as caught:
            run(sync.update_mlos_checkout(checkout, records([('g1', 'A', 1.0)])))
        self.assertEqual(caught.exception.msg, 'Invalid Checkout')
        self.assertIn('no_such_view', caught.exception.details)

    def test_the_event_loop_is_not_blocked_while_the_checkout_is_written(self):
        checkout = self.checkout()
        seed(self.path, [('g1', 'A', 1.0, 'g')])
        import time
        real = sync.apply_checkout_changes

        def slow(*a, **k):
            time.sleep(0.4)
            return real(*a, **k)

        async def go():
            ticks = []

            async def ticker():
                while True:
                    ticks.append(time.monotonic())
                    await asyncio.sleep(0.02)
            task = asyncio.create_task(ticker())
            with mock.patch.object(sync, 'apply_checkout_changes', slow):
                await sync.update_mlos_checkout(checkout, records([('g1', 'B', 1.0)]))
            task.cancel()
            return max(b - a for a, b in zip(ticks, ticks[1:]))
        self.assertLess(run(go()), 0.2)


class TestToSqlValue(unittest.TestCase):
    def test_conversions(self):
        f = sync.to_sql_value
        self.assertIsNone(f(None))
        self.assertIsNone(f(float('nan')))
        self.assertIsNone(f(pd.NaT))
        self.assertIsNone(f(np.datetime64('NaT', 'ns')))
        self.assertEqual(f(np.int64(5)), 5)
        self.assertIsInstance(f(np.int64(5)), int)
        self.assertIs(f(np.bool_(True)), True)
        self.assertEqual(f(pd.Timestamp('2026-01-02 03:04:05')), '2026-01-02 03:04:05')
        self.assertEqual(f(datetime(2026, 1, 2)), '2026-01-02T00:00:00'.replace('T', ' '))
        self.assertEqual(f(UUID('12345678-1234-5678-1234-567812345678')), '12345678-1234-5678-1234-567812345678')
        self.assertEqual(f('text'), 'text')
        self.assertEqual(f(0), 0)


class TestGetUpdatedRecords(unittest.TestCase):
    """tools.get_updated_records returns [changed, new]; the new ones must keep eha_guid or they cannot be inserted."""

    @classmethod
    def setUpClass(cls):
        anything = mock.MagicMock()
        cls.tools = load('mlos/planfeld/checkout_mgr/tools.py', {
            'tqdm': stand_in('tqdm', tqdm=anything),
            'geopandas': stand_in('geopandas', GeoDataFrame=pd.DataFrame),
            'toolbox.configs': stand_in('toolbox.configs', CONFIG={}),
            'toolbox.mlos': stand_in('toolbox.mlos', get_admin_col=anything),
            'toolbox.tools': stand_in('toolbox.tools', get_next_letter=anything, get_field_index=anything,
                                      find_column=anything, is_empty=anything),
        })

    def test_new_records_keep_their_guid_and_changed_ones_are_found(self):
        db = pd.DataFrame({'eha_guid': ['a', 'b', 'c'], 'name': ['A', 'B', 'C'], 'pop': [1, 2, 3]})
        new = pd.DataFrame({'eha_guid': ['a', 'b', 'c', 'd'], 'name': ['A', 'B2', 'C', 'D'], 'pop': [1, 2, 3, 4]})
        changed, added = self.tools.get_updated_records(db, new)
        self.assertEqual(changed['eha_guid'].tolist(), ['b'])
        self.assertEqual(added['eha_guid'].tolist(), ['d'])
        self.assertEqual(added.set_index('eha_guid').loc['d', 'name'], 'D')


class TestSynchronize(unittest.TestCase):
    def run_sync(self, mlos_takeoff_frame, counts, db_rows=2, mlos_rows=3):
        changed = pd.DataFrame({'eha_guid': ['a'], 'name': ['A2']})
        added = pd.DataFrame({'eha_guid': ['d'], 'name': ['D']})
        db = pd.DataFrame({'eha_guid': [f'g{i}' for i in range(db_rows)], 'name': 'x'})

        async def settlements_data():
            return db
        checkout = types.SimpleNamespace(settlements_data=settlements_data())
        apply = mock.AsyncMock(return_value=('the/updated.sqlite', counts))
        mlos = pd.DataFrame({'state': ['Kebbi'] * mlos_rows, 'eha_guid': [f'm{i}' for i in range(mlos_rows)]})
        tasks = object()
        with mock.patch.multiple(
                sync, detect_unique_admin_field=mock.DEFAULT, get_admin_col=mock.DEFAULT, ReadDBData=mock.DEFAULT,
                enrich_admin_codes=mock.DEFAULT, validate_settlements_takeoff_points=mock.DEFAULT,
                update_settlements=mock.DEFAULT, populate_editors=mock.DEFAULT, get_updated_records=mock.DEFAULT,
                apply_mlos_checkout=apply) as m:
            m['detect_unique_admin_field'].return_value = 'unique_code'
            m['get_admin_col'].return_value = 'state'
            m['validate_settlements_takeoff_points'].return_value = mlos_takeoff_frame
            m['update_settlements'].return_value = (pd.DataFrame({'eha_guid': ['a', 'd']}), ['z'])
            m['populate_editors'].side_effect = lambda frame, states: frame
            m['get_updated_records'].return_value = [changed, added]
            result = run(sync.synchronize_checkout_datasets(mlos, checkout, pd.DataFrame(), background_tasks=tasks))
        return result, apply, changed, added, tasks

    def test_changed_new_and_dropped_are_handed_to_the_sync_and_the_path_is_returned(self):
        counts = {'updated': 1, 'inserted': 1, 'deleted': 1, 'settlements_after': 2, 'takeoff_checkout': 40}
        result, apply, changed, added, tasks = self.run_sync(pd.DataFrame({'takeoffpoint_code': ['a']}), counts)
        self.assertEqual(result.path, 'the/updated.sqlite')  # the path of the changed database, for the route to serve
        kwargs = apply.call_args.kwargs
        self.assertIs(kwargs['updated_db_data'], changed)
        self.assertIs(kwargs['new_records'], added)
        self.assertEqual(kwargs['drop_ids'], ['z'])
        self.assertIs(kwargs['background_tasks'], tasks)
        self.assertTrue(kwargs['with_totals'])

    def test_the_summary_has_every_indicator_the_page_shows(self):
        counts = {'updated': 4, 'inserted': 7, 'deleted': 2, 'settlements_after': 103, 'takeoff_checkout': 40}
        takeoff = pd.DataFrame({'takeoffpoint_code': ['w1/a', 'w1/a', 'w2/b', None]})
        result, *_ = self.run_sync(takeoff, counts, db_rows=98, mlos_rows=105)
        self.assertEqual(result.summary, {
            'updated': 4, 'added': 7, 'removed': 2,
            'settlements_mlos': 105, 'settlements_checkout': 98, 'settlements_after': 103,
            'takeoff_mlos': 2, 'takeoff_checkout': 40})

    def test_the_summary_is_json_and_leaves_out_what_cannot_be_counted(self):
        import json
        counts = {'updated': 0, 'inserted': 0, 'deleted': 0, 'settlements_after': None, 'takeoff_checkout': None}
        result, *_ = self.run_sync(pd.DataFrame({'other': [1]}), counts)
        self.assertIsNone(result.summary['takeoff_mlos'])
        self.assertIsNone(result.summary['takeoff_checkout'])
        json.dumps(result.summary)

    def test_takeoff_points_are_counted_by_ward_and_name_without_a_code(self):
        frame = pd.DataFrame({'ward_code': ['w1', 'w1', 'w2', 'w2'], 'takeoffpoint': ['PHC', 'PHC', 'PHC', None]})
        self.assertEqual(sync.count_takeoff_points(frame), 2)
        self.assertIsNone(sync.count_takeoff_points(pd.DataFrame({'x': [1]})))


SUMMARY = {'updated': 4, 'added': 7, 'removed': 2, 'settlements_mlos': 105, 'settlements_checkout': 98,
           'settlements_after': 103, 'takeoff_mlos': 12, 'takeoff_checkout': 11}


class TestCheckoutRoute(unittest.TestCase):
    """POST /campaign/checkout awaits the sync, serves the updated database under the checkout's own name, and
    deletes the temporary copy once the response has been sent."""

    def load_route(self, sync_result):
        class Router:
            def post(self, *a, **k):
                return lambda f: f

        class FileResponse:
            def __init__(self, path, filename=None, media_type=None, background=None, headers=None):
                self.path, self.filename, self.media_type, self.background = path, filename, media_type, background
                self.headers = headers

        async def read_dataset(upload, *a):
            return pd.DataFrame({'eha_guid': [upload.filename]})

        calls = {}

        async def synchronize(settlements, checkout, takeoff):
            calls.update(settlements=settlements, checkout=checkout, takeoff=takeoff)
            return types.SimpleNamespace(path=sync_result, summary=SUMMARY)

        route = load('apps/planfeld/checkout.py', {
            'fastapi': stand_in('fastapi', APIRouter=Router, BackgroundTasks=object, UploadFile=object,
                                File=lambda *a, **k: None, Form=lambda *a, **k: None),
            'fastapi.responses': stand_in('fastapi.responses', FileResponse=FileResponse),
            'geopandas': stand_in('geopandas', GeoDataFrame=pd.DataFrame),
            'toolbox.access.read_mgr': stand_in('toolbox.access.read_mgr', read_dataset=read_dataset),
            'toolbox.utils.tempfiles': stand_in('toolbox.utils.tempfiles', delete_after_response=lambda path: ('delete', path)),
            'toolbox.mlos.planfeld.checkout_mgr.sync_db': stand_in(
                'toolbox.mlos.planfeld.checkout_mgr.sync_db', Checkout=lambda f: types.SimpleNamespace(checkout_file=f),
                synchronize_checkout_datasets=synchronize),
        })
        return route, calls

    def test_serves_the_updated_database_named_after_the_checkout(self):
        route, calls = self.load_route('/tmp/updated.sqlite')
        mlos = types.SimpleNamespace(filename='mlos.csv')
        checkout = types.SimpleNamespace(filename='ke_checkout.sqlite')
        response = run(route.update_checkout(mlos, checkout, None))
        self.assertEqual(response.path, '/tmp/updated.sqlite')
        self.assertEqual(response.filename, 'ke_checkout.sqlite')
        self.assertEqual(response.background, ('delete', '/tmp/updated.sqlite'))
        import json
        self.assertEqual(json.loads(response.headers['X-Checkout-Summary']), SUMMARY)
        self.assertTrue(calls['takeoff'].empty)  # no takeoff file: an empty frame, not an error

    def test_a_takeoff_file_is_read_and_passed_on(self):
        route, calls = self.load_route('/tmp/updated.sqlite')
        takeoff = types.SimpleNamespace(filename='takeoff.csv')
        run(route.update_checkout(
            types.SimpleNamespace(filename='m.csv'), types.SimpleNamespace(filename='c.sqlite'), takeoff))
        self.assertEqual(calls['takeoff']['eha_guid'].tolist(), ['takeoff.csv'])


if __name__ == '__main__':
    unittest.main()
