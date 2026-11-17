"""ReadDBData reads through a SQLAlchemy connection and leaves no connection open.

Found by the canary: pandas was handed a raw psycopg2 connection, so every plain-table read emitted
"pandas only supports SQLAlchemy connectable..."; when the process's warning filter was set to raise,
that warning turned /uuid_check and the GTS team review into HTTP 500s. SQLAlchemy is not installed in the
sandbox, so a fake engine stands in for it here.

Run from the repo root:  python -m unittest tests.test_db_reader -v
"""
import types
import unittest
import warnings
from unittest import mock

import pandas as pd

from tests.test_h7_readers import readers, EXC


class FakeConnection:
    def __init__(self, engine):
        self.engine = engine

    def __enter__(self):
        self.engine.open_connections += 1
        return self

    def __exit__(self, *exc):
        self.engine.open_connections -= 1
        return False

    def execute(self, statement, params=None):
        self.engine.executed.append((str(statement), params))
        return types.SimpleNamespace(fetchone=lambda: self.engine.geometry_row)


class FakeEngine:
    def __init__(self):
        self.open_connections = 0
        self.disposed = 0
        self.executed = []
        self.geometry_row = ('geom',)
        self.connections = []

    def connect(self):
        connection = FakeConnection(self)
        self.connections.append(connection)
        return connection

    def dispose(self):
        self.disposed += 1


def make_reader(table='settlements', spatial=False):
    engine = FakeEngine()
    credential = types.SimpleNamespace(connection_string='postgresql://fake')
    with mock.patch.object(readers, 'create_engine', lambda *a, **k: engine):
        reader = readers.ReadDBData(table, spatial, credential)
    return reader, engine


class ReadDBDataTests(unittest.TestCase):
    def test_record_exists_hands_pandas_a_sqlalchemy_connection_not_psycopg2(self):
        reader, engine = make_reader()
        calls = []

        def fake_read_sql(query, con, params=None):
            calls.append((query, con, params))
            return pd.DataFrame({'eha_guid': ['x']})

        parse = mock.Mock(return_value=('LOWER(eha_guid)=LOWER(%s)', ('abc',)))
        with mock.patch.object(readers.pd, 'read_sql', fake_read_sql), \
                mock.patch.object(readers, 'parse_read_parameters', parse):
            self.assertTrue(reader.record_exists({'eha_guid': ['abc']}))
        query, con, params = calls[0]
        self.assertIsInstance(con, FakeConnection)  # the engine's connection, never a psycopg2 one
        self.assertEqual(params, ('abc',))
        self.assertIn('WHERE LOWER(eha_guid)=LOWER(%s)', query)
        self.assertEqual(engine.disposed, 1)
        self.assertEqual(engine.open_connections, 0)

    def test_record_exists_is_false_for_no_rows_and_still_cleans_up(self):
        reader, engine = make_reader()
        parse = mock.Mock(return_value=('f=%s', ('abc',)))
        with mock.patch.object(readers.pd, 'read_sql', lambda *a, **k: pd.DataFrame()), \
                mock.patch.object(readers, 'parse_read_parameters', parse):
            self.assertFalse(reader.record_exists({'f': ['abc']}))
        self.assertEqual(engine.disposed, 1)

    def test_a_failing_query_still_releases_the_connection(self):
        reader, engine = make_reader()

        def boom(*args, **kwargs):
            raise RuntimeError('database went away')
        with mock.patch.object(readers.pd, 'read_sql', boom):
            with self.assertRaises(RuntimeError):
                reader.record_exists(None)
        self.assertEqual(engine.disposed, 1)
        self.assertEqual(engine.open_connections, 0)

    def test_read_data_for_a_plain_table_uses_the_open_connection(self):
        reader, engine = make_reader()
        seen = []

        def fake_read_sql(query, con, params=None):
            seen.append(con)
            return pd.DataFrame({'a': [1]})
        with mock.patch.object(readers.pd, 'read_sql', fake_read_sql):
            data = reader.read_data()
        self.assertEqual(len(data), 1)
        self.assertIs(seen[0], engine.connections[0])
        self.assertEqual(engine.disposed, 1)

    def test_an_empty_table_raises_no_records_found_and_cleans_up(self):
        reader, engine = make_reader()
        with mock.patch.object(readers.pd, 'read_sql', lambda *a, **k: pd.DataFrame()):
            with self.assertRaises(EXC.NoRecordsFound):
                reader.read_data()
        self.assertEqual(engine.disposed, 1)
        self.assertEqual(engine.open_connections, 0)

    def test_the_geometry_column_lookup_uses_a_bound_parameter(self):
        reader, engine = make_reader(table='wards', spatial=True)
        self.assertEqual(reader.geo_col, 'geom')
        statement, params = engine.executed[0]
        self.assertEqual(params, {'table_name': 'wards'})
        self.assertIn(':table_name', statement)
        self.assertNotIn('wards', statement)  # the table name is a parameter, never pasted into the SQL
        self.assertEqual(engine.open_connections, 0)
        engine.geometry_row = None
        other, other_engine = make_reader(table='plain', spatial=True)
        other_engine.geometry_row = None
        self.assertIsNone(other.geo_col)

    def test_construction_opens_no_connection(self):
        _, engine = make_reader()
        self.assertEqual(engine.connections, [])  # nothing is opened until a read asks for it

    def test_module_has_no_psycopg2_import_left(self):
        self.assertFalse(hasattr(readers, 'psycopg2'))


if __name__ == '__main__':
    unittest.main()
