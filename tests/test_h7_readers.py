"""Hardening item H7 for the shared file readers: parsing an upload must not freeze the API.

The readers (CSV/Excel, GeoPackage/SQLite, track filtering, workbook compilation) used to parse
the whole file on the event loop, so every other request - /health included - waited while a big
upload was read. They now parse in a worker thread. These tests measure the same thing as
test_offload.py (how long the event loop was unable to run) and also check that results, error
handling and temporary-file clean-up are unchanged.

Run from the repo root:  python -m unittest tests.test_h7_readers -v
The modules are loaded straight from their files with stand-ins for the database and spatial
libraries (importing toolbox.access pulls in the whole application); pandas and openpyxl are real.
"""
import asyncio
import contextvars
import importlib.util
import io
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd
from pandas.errors import ParserError

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_offload import worst_stall, SLOW, MAX_STALL

PACKAGE = Path(os.environ.get('TOOLBOX_SRC_DIR', Path(__file__).resolve().parents[1] / 'src' / 'toolbox'))


def stand_in(name, **attributes):
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    return module


class Problem(Exception):
    """Stand-in for the toolbox exceptions: (message, details)."""
    def __init__(self, msg='', details=None):
        super().__init__(msg)
        self.msg, self.details = msg, details


def exceptions_module():
    names = ['DataError', 'FileNotFound', 'NotSupportedError', 'NoRecordsFound', 'TableNotFound',
             'MissingConfiguration', 'InvalidInputError']
    return stand_in('toolbox.exceptions', **{name: type(name, (Problem,), {}) for name in names})


def load(relative: str, stubs: dict):
    """Execute one toolbox module with the given modules standing in for its imports."""
    saved = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        spec = importlib.util.spec_from_file_location('h7_under_test_' + relative.replace('/', '_'), PACKAGE / relative)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


class Upload:
    """Looks like a FastAPI UploadFile: filename, file, async read()."""
    def __init__(self, filename, content: bytes):
        self.filename, self.file, self._content = filename, io.BytesIO(content), content

    async def read(self, size=-1):
        data = self.file.read(size)
        return data


EXC = exceptions_module()
CONVERTED = object()
GEO_COLUMNS = object()
readers = load('access/read/readers.py', {
    'psycopg2': stand_in('psycopg2'),
    'geopandas': stand_in('geopandas', GeoDataFrame=pd.DataFrame),
    'sqlalchemy': stand_in('sqlalchemy', create_engine=lambda *a, **k: None, text=lambda q: q),
    'fastapi': stand_in('fastapi', UploadFile=Upload),
    'toolbox.utils': stand_in('toolbox.utils', Credential=object),
    'toolbox.spatial_mgr': stand_in(
        'toolbox.spatial_mgr',
        GeomColumns=types.SimpleNamespace(get_geom_cols=lambda data, has_coord: GEO_COLUMNS),
        convert_to_geodata=lambda data, columns: (CONVERTED, data, columns)),
    'toolbox.tools': stand_in('toolbox.tools', parse_read_parameters_ii=None, parse_read_parameters=None),
    'toolbox.access': stand_in('toolbox.access'),
    'toolbox.access.read': stand_in('toolbox.access.read'),
    'toolbox.access.read.spatial_handler': stand_in('toolbox.access.read.spatial_handler', ESRIHandler=object, OSGeoHandler=object),
    'toolbox.exceptions': EXC,
})

FRAME = pd.DataFrame({'name': ['a', 'b'], 'value': [1, 2]})


def csv_upload(name='data.csv'):
    return Upload(name, FRAME.to_csv(index=False).encode())


def xlsx_bytes(sheets: dict) -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        for title, frame in sheets.items():
            frame.to_excel(writer, sheet_name=title, index=False)
    return buffer.getvalue()


def slow(result):
    def work(*args, **kwargs):
        time.sleep(SLOW)
        return result
    return work


class ReadTableDataResults(unittest.TestCase):
    def test_csv_upload_is_parsed(self):
        data = asyncio.run(readers.ReadTableData(csv_upload(), False).read_data())
        pd.testing.assert_frame_equal(data, FRAME)

    def test_excel_upload_reads_the_requested_sheet(self):
        upload = Upload('book.xlsx', xlsx_bytes({'First': FRAME, 'Second': FRAME.assign(value=[9, 9])}))
        data = asyncio.run(readers.ReadTableData(upload, False).read_data('Second'))
        self.assertEqual(data['value'].tolist(), [9, 9])

    def test_excel_upload_defaults_to_the_first_sheet(self):
        upload = Upload('book.xlsx', xlsx_bytes({'First': FRAME, 'Second': FRAME.assign(value=[9, 9])}))
        data = asyncio.run(readers.ReadTableData(upload, False).read_data())
        pd.testing.assert_frame_equal(data, FRAME)

    def test_a_path_is_read_too(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'on_disk.csv')
            FRAME.to_csv(path, index=False)
            data = asyncio.run(readers.ReadTableData(path, False).read_data())
        pd.testing.assert_frame_equal(data, FRAME)

    def test_unsupported_extension_is_refused(self):
        with self.assertRaises(EXC.FileNotFound):
            asyncio.run(readers.ReadTableData(Upload('notes.txt', b'x'), False).read_data())

    def test_spatial_request_converts_the_parsed_data(self):
        result = asyncio.run(readers.ReadTableData(csv_upload(), True).read_data())
        marker, data, columns = result
        self.assertIs(marker, CONVERTED)
        self.assertIs(columns, GEO_COLUMNS)
        pd.testing.assert_frame_equal(data, FRAME)

    def test_a_ragged_csv_falls_back_to_the_tolerant_reader(self):
        # The failed first attempt consumes the upload, so the fallback must read it again from the start.
        ragged = Upload('ragged.csv', b'a,b\n1,2\n3,4,5\n6,7\n')
        data = asyncio.run(readers.ReadTableData(ragged, False).read_data())
        self.assertEqual(data['a'].tolist(), [1, 6])  # the bad line is skipped, like before

    def test_the_fallback_runs_when_the_first_parse_raises_a_parser_error(self):
        calls = []

        def read_csv(source, **kwargs):
            calls.append(kwargs)
            if not kwargs:
                raise ParserError('Error tokenizing data')
            return FRAME

        with mock.patch.object(readers.pd, 'read_csv', read_csv):
            data = asyncio.run(readers.ReadTableData(csv_upload(), False).read_data())
        pd.testing.assert_frame_equal(data, FRAME)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1].get('on_bad_lines'), 'skip')

    def test_other_errors_still_reach_the_caller(self):
        with mock.patch.object(readers.pd, 'read_csv', side_effect=ValueError('corrupt')):
            with self.assertRaises(ValueError):
                asyncio.run(readers.ReadTableData(csv_upload(), False).read_data())


class ReadTableDataKeepsTheLoopFree(unittest.TestCase):
    def test_parsing_a_big_file_does_not_freeze_the_loop(self):
        with mock.patch.object(readers.pd, 'read_csv', slow(FRAME)):
            result, stall = asyncio.run(worst_stall(lambda: readers.ReadTableData(csv_upload(), False).read_data()))
        self.assertLess(stall, MAX_STALL)
        pd.testing.assert_frame_equal(result, FRAME)

    def test_excel_parsing_does_not_freeze_the_loop(self):
        upload = Upload('book.xlsx', xlsx_bytes({'First': FRAME}))
        with mock.patch.object(readers.pd, 'read_excel', slow(FRAME)):
            _, stall = asyncio.run(worst_stall(lambda: readers.ReadTableData(upload, False).read_data()))
        self.assertLess(stall, MAX_STALL)

    def test_control_the_same_parse_run_on_the_loop_would_have_frozen_it(self):
        async def blocking():
            slow(FRAME)()
        _, stall = asyncio.run(worst_stall(blocking))
        self.assertGreater(stall, SLOW * 0.8)

    def test_the_job_id_for_live_logs_reaches_the_worker_thread(self):
        job = contextvars.ContextVar('job', default='none')
        seen = []

        def read_csv(source, **kwargs):
            seen.append(job.get())
            return FRAME

        async def scenario():
            job.set('job-7')
            return await readers.ReadTableData(csv_upload(), False).read_data()

        with mock.patch.object(readers.pd, 'read_csv', read_csv):
            asyncio.run(scenario())
        self.assertEqual(seen, ['job-7'])


# ---- OSGeoHandler (GeoPackage / SQLite uploads) -------------------------------------------------
LAYER = object()
spatial = load('access/read/spatial_handler.py', {
    'pyogrio': stand_in('pyogrio'),
    'geopandas': stand_in('geopandas', read_file=lambda path, layer=None: LAYER),
    'fastapi': stand_in('fastapi', UploadFile=Upload),
    'toolbox.utils': stand_in('toolbox.utils', atimer=lambda fn: fn),
    'toolbox.tools': stand_in('toolbox.tools', extract_and_find_file=None),
    'toolbox.exceptions': EXC,
})


class OSGeoHandlerTests(unittest.TestCase):
    def handler(self, source, table=None, valid=True, tables=('roads',)):
        handler = spatial.OSGeoHandler(source, table)
        patches = [
            mock.patch.object(spatial.OSGeoHandler, 'is_valid_sqlite', staticmethod(lambda path: valid)),
            mock.patch.object(spatial.OSGeoHandler, 'get_spatial_tables', staticmethod(lambda path: list(tables))),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return handler

    def saved_copy_of(self, handler):
        """Run the handler and report the path its saved upload had, observed while it was being read."""
        seen = {}

        def read_file(path, layer=None):
            seen['path'] = path
            seen['existed'] = os.path.exists(path)
            return LAYER

        with mock.patch.object(spatial.gpd, 'read_file', read_file):
            result = asyncio.run(handler.read_spatial_data())
        return result, seen

    def test_an_upload_is_read_and_its_saved_copy_is_deleted(self):
        handler = self.handler(Upload('layers.gpkg', b'not really sqlite'))
        result, seen = self.saved_copy_of(handler)
        self.assertIs(result, LAYER)
        self.assertTrue(seen['existed'], 'the layer is read from the saved copy')
        self.assertFalse(os.path.exists(seen['path']), 'saved copy must not be left behind')

    def test_the_saved_copy_is_deleted_when_reading_fails(self):
        handler = self.handler(Upload('layers.gpkg', b'x'))
        seen = {}

        def read_file(path, layer=None):
            seen['path'] = path
            raise RuntimeError('corrupt layer')

        with mock.patch.object(spatial.gpd, 'read_file', read_file):
            with self.assertRaises(RuntimeError):
                asyncio.run(handler.read_spatial_data())
        self.assertFalse(os.path.exists(seen['path']))

    def test_an_invalid_database_is_refused_and_cleaned_up(self):
        handler = self.handler(Upload('bad.gpkg', b'x'), valid=False)
        created = []
        original = spatial.OSGeoHandler.save_uploaded_file

        async def spy(self_):
            path = await original(self_)
            created.append(path)
            return path

        with mock.patch.object(spatial.OSGeoHandler, 'save_uploaded_file', spy):
            with self.assertRaises(EXC.DataError):
                asyncio.run(handler.read_spatial_data())
        self.assertEqual(len(created), 1)
        self.assertFalse(os.path.exists(created[0]))

    def test_an_unknown_table_is_reported_with_the_available_ones(self):
        handler = self.handler(Upload('layers.gpkg', b'x'), table='rivers', tables=('roads', 'wards'))
        with self.assertRaises(EXC.TableNotFound) as caught:
            asyncio.run(handler.read_spatial_data())
        self.assertIn('roads, wards', caught.exception.details)

    def test_a_path_on_disk_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'existing.gpkg')
            Path(path).write_bytes(b'x')
            handler = self.handler(path)
            result, _ = self.saved_copy_of(handler)
            self.assertIs(result, LAYER)
            self.assertTrue(os.path.exists(path))

    def test_unsupported_extension_is_refused(self):
        with self.assertRaises(EXC.NotSupportedError):
            asyncio.run(spatial.OSGeoHandler(Upload('layers.csv', b'x')).read_spatial_data())

    def test_reading_a_big_layer_does_not_freeze_the_loop(self):
        handler = self.handler(Upload('layers.gpkg', b'x'))
        with mock.patch.object(spatial.gpd, 'read_file', slow(LAYER)):
            result, stall = asyncio.run(worst_stall(handler.read_spatial_data))
        self.assertIs(result, LAYER)
        self.assertLess(stall, MAX_STALL)


# ---- read_compiled_data ------------------------------------------------------------------------
helper = load('tools/helper.py', {
    'tqdm': stand_in('tqdm', tqdm=lambda iterable=None, **kwargs: iterable),
    'toolbox.tools': stand_in('toolbox.tools', is_empty=lambda value: not value),
    'toolbox.configs': stand_in('toolbox.configs', CONFIG={}),
    'toolbox.reporting': stand_in('toolbox.reporting', Report=object),
    'toolbox.exceptions': EXC,
})


class ReadCompiledDataTests(unittest.TestCase):
    def test_every_sheet_is_returned_by_name(self):
        upload = Upload('compiled.xlsx', xlsx_bytes({'Kano': FRAME, 'Lagos': FRAME.assign(value=[5, 6])}))
        datasets = asyncio.run(helper.read_compiled_data(upload))
        self.assertEqual(list(datasets), ['Kano', 'Lagos'])
        pd.testing.assert_frame_equal(datasets['Kano'], FRAME)
        self.assertEqual(datasets['Lagos']['value'].tolist(), [5, 6])

    def test_a_zip_is_handed_to_the_zip_reader(self):
        upload = Upload('compiled.zip', b'x')
        with mock.patch.object(helper, 'read_zip_file_in_memory_ii', lambda zip_file: {'one': FRAME}) as reader:
            datasets = asyncio.run(helper.read_compiled_data(upload))
        self.assertEqual(list(datasets), ['one'])

    def test_unknown_formats_are_refused(self):
        with self.assertRaises(EXC.DataError):
            asyncio.run(helper.read_compiled_data(Upload('compiled.csv', b'x')))

    def test_reading_a_big_workbook_does_not_freeze_the_loop(self):
        upload = Upload('compiled.xlsx', xlsx_bytes({'Kano': FRAME}))
        with mock.patch.object(helper, '_read_workbook_sheets', slow({'Kano': FRAME})):
            _, stall = asyncio.run(worst_stall(lambda: helper.read_compiled_data(upload)))
        self.assertLess(stall, MAX_STALL)

    def test_a_big_zip_does_not_freeze_the_loop(self):
        upload = Upload('compiled.zip', b'x')
        with mock.patch.object(helper, 'read_zip_file_in_memory_ii', slow({'one': FRAME})):
            _, stall = asyncio.run(worst_stall(lambda: helper.read_compiled_data(upload)))
        self.assertLess(stall, MAX_STALL)


# ---- filter_valid_tracks -----------------------------------------------------------------------
def find_column(frame, col_name):
    return next(column for column in frame.columns if col_name in column.lower())


preprocess = load('tracks_manager/preprocess.py', {
    'geopandas': stand_in('geopandas', GeoDataFrame=pd.DataFrame),
    'toolbox.models': stand_in('toolbox.models', State=object),
    'toolbox.configs': stand_in('toolbox.configs', CONFIG={'REGEX': {'COORD_PATTERN': r'^-?\d+(\.\d+)?$'}, 'DATASETS': {}}),
    'toolbox.tools': stand_in('toolbox.tools', find_column=find_column),
    'toolbox.access': stand_in('toolbox.access', ReadDBData=object),
    'toolbox.spatial_mgr': stand_in('toolbox.spatial_mgr', SpatialOps=object),
    'toolbox.exceptions': EXC,
})


def tracks():
    return pd.DataFrame({
        'Latitude': ['10.5', '10.6', 'oops', '10.7', '10.8'],
        'Longitude': ['8.1', '8.2', '8.3', '8.4', '8.5'],
        'Speed MPS': ['0.2', '3.0', '0.1', '0.4', '0.3'],
        'GPS Timestamp': [
            '03/04/2026 09:00:00',   # kept
            '03/04/2026 09:05:00',   # too fast
            '03/04/2026 09:10:00',   # unreadable latitude
            '03/04/2026 18:00:00',   # outside working hours
            '03/04/2026 07:30:00',   # kept
        ],
    })


@preprocess.filter_valid_tracks(default_filter=True)
async def read_stub(frame):
    return frame


class FilterValidTracksTests(unittest.TestCase):
    def test_valid_tracks_are_kept_and_typed(self):
        kept = asyncio.run(read_stub(tracks()))
        self.assertEqual([round(v, 3) for v in kept['Latitude'].tolist()], [10.5, 10.8])
        self.assertEqual(str(kept['Latitude'].dtype), 'float32')
        self.assertIn('timestamp', kept.columns)

    def test_without_the_filter_only_unreadable_rows_are_dropped(self):
        kept = asyncio.run(read_stub(tracks(), apply_filter=False))
        self.assertEqual(len(kept), 4)
        self.assertNotIn('timestamp', kept.columns)

    def test_errors_in_the_wrapped_reader_propagate(self):
        @preprocess.filter_valid_tracks()
        async def failing():
            raise FileNotFoundError('no tracks')
        with self.assertRaises(FileNotFoundError):
            asyncio.run(failing())

    def test_filtering_a_big_dataset_does_not_freeze_the_loop(self):
        with mock.patch.object(preprocess, '_keep_valid_tracks', slow('filtered')):
            result, stall = asyncio.run(worst_stall(lambda: read_stub(tracks())))
        self.assertEqual(result, 'filtered')
        self.assertLess(stall, MAX_STALL)


if __name__ == '__main__':
    unittest.main()
