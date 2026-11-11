"""Hardening item H7 for the individual routes: the analysis inside a route must not freeze the API.

Before, most routes called their analysis functions straight from the `async def` handler, so every
other request - /health included - waited until the analysis finished. They now hand that work to a
worker thread (toolbox.utils.offload.run_heavy for analysis, run_in_threadpool for short reads).

Two kinds of test:

  * behaviour - each route is loaded from its own file with stand-ins for everything it imports, the
    analysis is replaced by a function that sleeps, and a ticker measures how long the event loop was
    unable to run (the same measure as test_offload.py). The result must still come back.
  * guard - the route files are read as source and any analysis call left directly on the event loop
    fails the test, so a route edited later cannot quietly bring the problem back.

Run from the repo root:  python -m unittest tests.test_h7_routes -v
Set TOOLBOX_SRC_DIR to test a source tree other than ./src/toolbox.
"""
import ast
import asyncio
import importlib.util
import io
import os
import sys
import tempfile
import time
import types
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pandas as pd

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_offload import worst_stall, SLOW, MAX_STALL
from toolbox.utils import offload

PACKAGE = Path(os.environ.get('TOOLBOX_SRC_DIR', Path(__file__).resolve().parents[1] / 'src' / 'toolbox'))


# --------------------------------------------------------------------------------------- stand-ins

class Permissive(types.ModuleType):
    """A module that has whatever is asked of it (a mock) unless the test supplied the real thing."""
    __path__ = []

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        value = mock.MagicMock(name=f'{self.__name__}.{name}')
        setattr(self, name, value)
        return value


def decorator(*args, **kwargs):
    """Stand-in for timer/atimer: works both as @timer and as @timer(title=...)."""
    if len(args) == 1 and callable(args[0]) and not kwargs:
        return args[0]
    return lambda function: function


class Router:
    def _register(self, *_a, **_k):
        return lambda function: function

    post = patch = get = put = _register


class Streaming:
    def __init__(self, content=None, **kwargs):
        self.content, self.kwargs = content, kwargs


def nothing(*_a, **_k):
    return None


async def afile_response(writer, suffix, media_type, name):
    return ('file', suffix, media_type, name)


def slow(result=None, seconds=SLOW):
    """An 'analysis': blocks the thread it runs on for `seconds`, then returns `result` (called with any arguments)."""
    def work(*_a, **_k):
        time.sleep(seconds)
        return result
    return work


def serving(value):
    async def read(*_a, **_k):
        return value.copy() if hasattr(value, 'copy') else value
    return read


def upload(name='data.csv'):
    return SimpleNamespace(filename=name, file=io.BytesIO(b''))


BASE = {
    'fastapi': dict(APIRouter=Router, UploadFile=object, File=nothing, Form=nothing, Query=nothing,
                    BackgroundTasks=object, HTTPException=Exception, Response=object),
    'fastapi.responses': dict(FileResponse=object, StreamingResponse=Streaming, Response=object),
    'toolbox.utils': dict(timer=decorator, atimer=decorator, logger=nothing),
    'tqdm': dict(tqdm=lambda iterable=None, *a, **k: iterable),
    'toolbox.utils.tempfiles': dict(afile_response=afile_response),
    'toolbox.utils.offload': None,       # the real one
}
REAL = {'pandas', 'numpy', 'starlette', 'openpyxl', 'uuid'} | set(sys.stdlib_module_names)


def is_toolbox_module(name: str) -> bool:
    if not name.startswith('toolbox.'):
        return False
    base = PACKAGE.joinpath(*name.split('.')[1:])
    return base.is_dir() or base.with_suffix('.py').is_file()


def imported_modules(source: str) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module)
            # `from toolbox.access import read_mgr` imports a module; `from toolbox.configs import CONFIG` does not.
            names.update(f'{node.module}.{alias.name}' for alias in node.names
                         if is_toolbox_module(f'{node.module}.{alias.name}'))
        elif isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
    return names


def load_route(relative: str, **overrides):
    """Execute one toolbox file with every module it imports replaced (except pandas/numpy/starlette/stdlib).

    `overrides` maps a module name to the attributes the test wants it to have; any other attribute of
    those modules is a mock.
    """
    path = PACKAGE / relative
    source = path.read_text(encoding='utf-8')
    wanted = {name: attrs for name, attrs in BASE.items()}
    for name, attrs in overrides.items():
        wanted[name] = {**(wanted.get(name) or {}), **attrs}

    stubs = {}
    for name in imported_modules(source) | set(wanted):
        if name.split('.')[0] in REAL and name not in wanted:
            continue
        if name == 'toolbox.utils.offload':
            stubs[name] = offload
            continue
        module = stubs.get(name) or Permissive(name)
        for attribute, value in (wanted.get(name) or {}).items():
            setattr(module, attribute, value)
        stubs[name] = module
    # `from toolbox.access import read_mgr` style imports: expose the submodule stub as an attribute too.
    for name, module in list(stubs.items()):
        parent, _, child = name.rpartition('.')
        if parent in stubs and not isinstance(getattr(stubs[parent], child, None), types.ModuleType):
            if not (wanted.get(parent) or {}).get(child):
                setattr(stubs[parent], child, module)

    saved = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        spec = importlib.util.spec_from_file_location('h7_route_' + relative.replace('/', '_').replace('.', '_'), path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


def measure(call):
    """Run `call()` (a coroutine function) with a ticker on the loop; return (result, longest stall, seconds taken)."""
    started = time.perf_counter()
    result, stall = asyncio.run(worst_stall(call))
    return result, stall, time.perf_counter() - started


class Responsive(unittest.TestCase):
    def check(self, call, expect=None):
        result, stall, taken = measure(call)
        self.assertLess(stall, MAX_STALL, f'the event loop was stuck for {stall:.2f}s')
        self.assertGreater(taken, SLOW * 0.8, 'the stand-in analysis never ran')
        if expect is not None:
            self.assertEqual(result, expect)
        return result

    def setUp(self):
        patch = mock.patch.dict(os.environ, {}, clear=False)
        patch.start()
        self.addCleanup(patch.stop)
        os.environ.pop('HEAVY_JOB_LIMIT', None)


FRAME = pd.DataFrame({'unique_code': ['a', 'b'], 'name': ['x', 'y']})
CSV = ('file', '.csv', 'text/csv')


# ---------------------------------------------------------------------------------------- MLoS routes

class TestMlosRoutes(Responsive):
    def test_standardizer(self):
        route = load_route(
            'apps/mlos/standardizer.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos.transform': dict(standardize_mlos_records=slow(FRAME))})
        result = self.check(lambda: route.standardize_mlos(upload()))
        self.assertEqual(result[:3], CSV)

    def test_duplicate_checker(self):
        route = load_route(
            'apps/mlos/duplicate_checker.py',
            **{'fastapi': dict(UploadFile=object),
               'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos': dict(detect_unique_admin_field=lambda d: 'unique_code'),
               'toolbox.mlos.validation.review': dict(duplicate_deep_search_protocol=slow(FRAME)),
               'toolbox.errors': dict(DataContractError=Exception)})
        result = self.check(lambda: route.search_for_duplicate_settlements(upload(), 80, False))
        self.assertEqual(result[:3], CSV)

    def test_fixer_takeoff_points(self):
        route = load_route(
            'apps/mlos/fixer.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.fixers': dict(populate_takeoff_point=slow(FRAME))})
        result = self.check(lambda: route.fix_operations(upload(), populate_takeoff=True))
        self.assertEqual(result[:3], CSV)

    def test_fixer_shift_points_and_global_id(self):
        shifted = pd.DataFrame({'latitude': [1.0], 'unique_code': ['a']})
        route = load_route(
            'apps/mlos/fixer.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(pd.DataFrame({'latitude': [1.0, None], 'unique_code': ['a', 'b']}))),
               'toolbox.fixers': dict(auto_shift_points=slow(shifted, SLOW / 2), populate_global_id=slow(shifted, SLOW / 2))})
        self.check(lambda: route.fix_operations(upload(), shift_points=True, set_global_id=True, state='Kebbi'))

    def test_fixer_still_asks_for_a_state_before_shifting(self):
        class Problem(Exception):
            pass
        route = load_route(
            'apps/mlos/fixer.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.exceptions': dict(InvalidInputError=Problem)})
        with self.assertRaises(Problem):
            asyncio.run(route.fix_operations(upload(), shift_points=True))

    def test_qc_route_standardise_and_unique_code(self):
        qc_result = FRAME
        route = load_route(
            'apps/mlos/qc_mlos.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos.transform': dict(standardize_mlos_records=slow(FRAME)),
               'toolbox.mlos': dict(detect_unique_admin_field=lambda d: 'unique_code'),
               'toolbox.mlos.validation.review.run_validate': dict(run_settlements_qc=serving(qc_result))})
        result = self.check(lambda: route.validate_mlos(upload(), standardize=True))
        self.assertEqual(result[:3], CSV)

    def test_qc_library_runs_its_checks_in_a_worker_thread(self):
        passthrough = lambda frame, *_a, **_k: frame
        library = load_route(
            'mlos/validation/review/run_validate.py',
            **{'toolbox.mlos.validation.review.prefilter':
                   dict(flag_validated_unknown_settlements=lambda df, attrs: df.assign(is_invalid=False)),
               'toolbox.mlos.validation.review.spatial.spatial_checks': dict(run_spatial_checks=passthrough),
               'toolbox.mlos.validation.review.summarize': dict(flag_settlements=passthrough),
               'toolbox.mlos': dict(evaluate_settlement_validation=passthrough),
               'toolbox.mlos.validation.review': dict(
                   find_duplicate_attributes=lambda df, geo, code: (time.sleep(SLOW), df)[1],
                   validate_attributes_entry=passthrough,
                   review_attributes_consistency=passthrough,
                   duplicate_deep_search_protocol=passthrough)})
        result = self.check(lambda: library.run_settlements_qc(FRAME, 'unique_code', True, False))
        self.assertEqual(len(result), len(FRAME))

    def test_update_validation(self):
        validated = pd.DataFrame({'unique_code': ['a'], 'name': ['z']})
        workbook = SimpleNamespace(sheetnames=['Sheet1'])
        updated = FRAME.copy()
        route = load_route(
            'apps/mlos/update_validation.py',
            **{'openpyxl': dict(load_workbook=lambda path: (time.sleep(SLOW / 2), workbook)[1]),
               'toolbox.access.read.spatial_handler': dict(
                   ESRIHandler=SimpleNamespace(save_uploaded_file=serving('/tmp/a.xlsx'))),
               'toolbox.access.read_mgr': dict(read_dataset=serving(validated)),
               'toolbox.mlos.transformers': dict(common_transformations=lambda df: df),
               'toolbox.mlos.validation': dict(update=SimpleNamespace(update_mlos=slow(updated, SLOW / 2)))})
        result = self.check(lambda: route.update_validation_data(
            upload('mlos.csv'), [upload('lga.xlsx')], 'MP'))
        self.assertEqual(result[:3], CSV)

    def test_coordinate_review_library(self):
        library = load_route('mlos/validation/review/spatial/coordinate_reviewer.py')
        library._review_settlement_coordinates = slow(FRAME)
        result, stall, taken = measure(lambda: library.review_settlement_coordinates({}, FRAME, None, False))
        self.assertLess(stall, MAX_STALL)
        self.assertGreater(taken, SLOW * 0.8)
        self.assertEqual(len(result), len(FRAME))


# ----------------------------------------------------------------------------------- campaign routes

class TestCampaignRoutes(Responsive):
    def test_contact_analysis_library(self):
        library = load_route('campaign/contact_analysis.py')
        library._contact_analysis = slow(FRAME)
        result, stall, taken = measure(lambda: library.execute_contact_analysis(FRAME, {}))
        self.assertLess(stall, MAX_STALL)
        self.assertGreater(taken, SLOW * 0.8)
        self.assertEqual(len(result), len(FRAME))

    def test_submission_reviewer(self):
        route = load_route(
            'apps/campaign/submission_reviewer.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.campaign.submission_reviewer': dict(review_submission=slow(FRAME))})
        result = self.check(lambda: route.campaign_submissions_reviewer(upload(), None))
        self.assertEqual(result[:3], CSV)

    def test_target_area_for_settlements(self):
        dataset = SimpleNamespace(voronoi=1, gridded_ta=2, voronoi_subset=3, gridded_ta_subset=4)
        route = load_route(
            'apps/campaign/target_area.py',
            **{'toolbox.access': dict(read_mgr=SimpleNamespace(read_dataset=serving(FRAME))),
               'toolbox.target_area.v1.generate': dict(generate_settlement_target_area=slow(dataset))})
        result = self.check(lambda: route.generate_target_area(upload(), None, None))
        self.assertIsInstance(result, Streaming)
        self.assertEqual(result.kwargs['media_type'], 'application/x-zip-compressed')

    def test_target_area_zip_is_built_off_the_loop(self):
        dataset = SimpleNamespace(voronoi=1, gridded_ta=2)
        route = load_route(
            'apps/campaign/target_area.py',
            **{'toolbox.access': dict(read_mgr=SimpleNamespace(read_dataset=serving(FRAME))),
               'toolbox.access.export_mgr': dict(add_to_archive=lambda *a, **k: time.sleep(SLOW / 2)),
               'toolbox.target_area.v1.generate': dict(generate_settlement_target_area=lambda *a: dataset)})
        self.check(lambda: route.generate_target_area(upload(), None, None))

    def test_buffer_target_area_route_and_library(self):
        library = load_route('target_area/buffer_target_area.py')
        library._generate_buffer_target_area = slow(('voronoi', 'grids'))
        route = load_route(
            'apps/campaign/target_area.py',
            **{'toolbox.access': dict(read_mgr=SimpleNamespace(read_dataset=serving(FRAME))),
               'toolbox.access.export_mgr': dict(add_to_archive=lambda *a, **k: None),
               'toolbox.target_area.buffer_target_area': dict(generate_buffer_target_area=library.generate_buffer_target_area)})
        result = self.check(lambda: route.generate_buffer_based_ta(upload(), 200))
        self.assertIsInstance(result, Streaming)


# ----------------------------------------------------------------------------------- compiler routes

class TestCompilerRoutes(Responsive):
    def test_lga_data(self):
        route = load_route(
            'apps/aggregators/lga_data.py',
            **{'toolbox.access.read.spatial_handler': dict(
                   ESRIHandler=SimpleNamespace(save_uploaded_file=serving('/tmp/lga.zip'))),
               'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME),
                                               get_excel_sheet_names=lambda files: (time.sleep(SLOW / 3), {'f.xlsx': ['s']})[1]),
               'toolbox.tools': dict(extract_and_find_file=lambda *a: (time.sleep(SLOW / 3), ['f.xlsx'])[1]),
               'toolbox.mlos.transformers.common': dict(common_transformations=lambda df: df),
               'toolbox.mlos.validation.update': dict(standardize_admin_records=lambda df, policy: (time.sleep(SLOW / 3), df)[1]),
               'toolbox.models': dict(Policy=SimpleNamespace(MP='MP'))})
        result = self.check(lambda: route.combine_lga_data(
            upload('lgas.zip'), SimpleNamespace(value='xlsx'), None))
        self.assertEqual(result[:3], CSV)

    def test_disaggregate(self):
        mlos = pd.DataFrame({'State': ['K', 'K'], 'LGA': ['a', 'b'], 'Ward': ['w1', 'w2'], 'x': [1, 2]})
        route = load_route(
            'apps/aggregators/splitter.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(mlos)),
               'toolbox.mlos': dict(get_admin_col=lambda df, col: {'state': 'State', 'lga': 'LGA', 'ward': 'Ward'}[col],
                                    detect_unique_admin_field=lambda df: 'x',
                                    MLoSAttributes=lambda: slow(SimpleNamespace(preset_attributes={})))})
        result = self.check(lambda: route.disaggregate_mlos(upload('mlos.csv'), 'LGA'))
        self.assertEqual(result[1], '.xlsx')

    def test_combine_tracks_packaging(self):
        class Tracks:
            empty = False

            def to_file(self, buffer, **kwargs):
                time.sleep(SLOW)
                buffer.write(b'gpkg')

        route = load_route(
            'apps/aggregators/tracks.py',
            **{'toolbox.tracks_manager.tr': dict(read_tracks=serving(Tracks()))})
        result = self.check(lambda: route.combine_tracks(
            upload('tracks.zip'), SimpleNamespace(value='csv'), None, None, True))
        self.assertIsInstance(result, Streaming)
        self.assertEqual(result.content.read(), b'gpkg')

    def test_combine_tracks_with_no_tracks_in_the_states_is_an_error_not_a_response(self):
        class NoRecords(Exception):
            pass

        class Tracks:
            empty = True

        route = load_route(
            'apps/aggregators/tracks.py',
            **{'toolbox.exceptions': dict(NoRecordsFound=NoRecords, DataError=Exception),
               'toolbox.spatial_mgr': dict(SpatialOps=SimpleNamespace(clip_dataset=lambda tracks, boundary: tracks)),
               'toolbox.access': dict(ReadDBData=lambda *a: SimpleNamespace(read_data=lambda q: None)),
               'toolbox.tracks_manager.tr': dict(read_tracks=serving(Tracks()))})
        with self.assertRaises(NoRecords):
            asyncio.run(route.combine_tracks(
                upload('tracks.zip'), SimpleNamespace(value='csv'), None, [SimpleNamespace(value='Kebbi')], True))


# ------------------------------------------------------------------------------------ microplan routes

class TestMicroplanRoutes(Responsive):
    def test_dip(self):
        route = load_route(
            'apps/planfeld/dip.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos.planfeld': dict(populate_daily_implementation_plan=slow(FRAME))})
        result = self.check(lambda: route.extract_daily_plan(upload()))
        self.assertEqual(result[:3], CSV)

    def test_dmp(self):
        route = load_route('apps/planfeld/dmp.py')
        route.extract_and_retrieve_datasets = slow({'lga': FRAME})
        result = self.check(lambda: route.combine_dmp_files(upload('dmp.zip'), 'keep'))
        self.assertEqual(result[1], '.xlsx')

    def test_dip_validator(self):
        route = load_route(
            'apps/planfeld/dip_template.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos.planfeld': dict(validate_daily_implementation_plan=slow({'a': FRAME}))})
        result = self.check(lambda: route.validate_microplan(upload(), upload('teams.csv')))
        self.assertEqual(result[1], '.xlsx')

    def test_dip_generator(self):
        directory = tempfile.mkdtemp()

        def new_result_file(suffix):
            handle, path = tempfile.mkstemp(suffix=suffix, dir=directory)
            os.close(handle)
            return path

        route = load_route(
            'apps/planfeld/dip_template.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.mlos.planfeld': dict(generate_team_dips=slow(({'a': FRAME}, []))),
               'toolbox.utils.tempfiles': dict(new_result_file=new_result_file, remove_file=os.remove,
                                               afile_response=afile_response),
               'toolbox.tools': dict(generate_output_name=lambda *a, **k: 'dip.xlsx')})
        result = self.check(lambda: route.generate_daily_implementation_plan(upload(), False, None))
        self.assertIsInstance(result, Streaming)
        self.assertEqual(os.listdir(directory), [], 'the temporary workbook must be removed')

    def test_dip_merger(self):
        route = load_route(
            'apps/planfeld/dip_template.py',
            **{'toolbox.tools': dict(save_uploaded_file=serving('/tmp/x.zip'), is_empty=lambda value: False,
                                     extract_and_find_file=lambda *a: time.sleep(SLOW / 3)),
               'toolbox.mlos.planfeld': dict(merge_maps_to_dips=slow([]))})
        result = self.check(lambda: route.merge_dip_and_maps(upload('maps.zip'), upload('dip.zip'), 'a', None))
        self.assertIsInstance(result, Streaming)


# ------------------------------------------------------------------------------- reporting and queries

class TestReportRoutes(Responsive):
    def test_post_implementation_report(self):
        route = load_route(
            'apps/tracking/reporter/post_implementation_report.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.tools': dict(find_column=lambda data, col, error: col),
               'toolbox.reporting.create_reports': dict(generate_post_implementation_report=slow(['chart']))})
        self.check(lambda: route.generate_post_implementation_reports(upload(), 'Visitation'), expect=['chart'])

    def test_daily_report(self):
        class DailyReport:
            def __init__(self, *args):
                pass

            def generate_report(self):
                time.sleep(SLOW)
                return ['chart']

        route = load_route(
            'apps/tracking/reporter/campaign_day_reporting.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.reporting': dict(DailyReport=DailyReport)})
        self.check(lambda: route.generate_campaign_daily_report(upload(), 'day', 'coverage'), expect=['chart'])

    def test_timespent(self):
        route = load_route(
            'apps/tracking/reporter/timespent.py',
            **{'toolbox.access.read_mgr': dict(read_dataset=serving(FRAME)),
               'toolbox.reporting': dict(execute_timespent_analysis=slow(pd.DataFrame({'a': [1]})))})
        result = self.check(lambda: route.timespent_analysis(upload(), 'table', None, 1))
        self.assertEqual(result[1], '.csv')


class TestUuidRoutes(Responsive):
    def setUp(self):
        super().setUp()
        self.queries = []

        class ReadDBData:
            def __init__(inner, *_a):
                pass

            def record_exists(inner, where):
                time.sleep(SLOW / 3)
                self.queries.append(where)
                return True

        self.route = load_route('apps/db_access/uuid_checker.py', **{'toolbox.access': dict(ReadDBData=ReadDBData)})

    def test_batch_check_runs_every_query_off_the_loop(self):
        ids = [uuid.uuid4() for _ in range(3)]
        result = self.check(lambda: self.route.batch_check_uuid_exist(ids))
        self.assertEqual([r.uuid for r in result.response], ids)
        self.assertEqual(len(self.queries), 3)
        self.assertTrue(all(r.exists is self.route.Exists.EXISTS for r in result.response))

    def test_single_check(self):
        self.route.ReadDBData = lambda *a: SimpleNamespace(
            record_exists=lambda where: (time.sleep(SLOW), False)[1])
        identifier = uuid.uuid4()
        result = self.check(lambda: self.route.uuid_exist(identifier))
        self.assertIs(result.exists, self.route.Exists.NO)


# --------------------------------------------------------------------------------------------- guard

# For each file: the calls that do the real work and so may never be made directly from an `async def`
# (call them through run_heavy / run_in_threadpool instead). Calls made inside a nested function that is
# handed to run_heavy are fine - the guard does not look inside nested functions.
ON_THE_LOOP_FORBIDDEN = {
    'apps/aggregators/lga_data.py': {'extract_and_find_file', 'get_excel_sheet_names', 'common_transformations', 'standardize_admin_records'},
    'apps/aggregators/splitter.py': {'MLoSAttributes', 'groupby', 'detect_unique_admin_field'},
    'apps/aggregators/tracks.py': {'clip_dataset', 'sjoin', 'to_file', 'clip_and_package'},
    'apps/campaign/submission_reviewer.py': {'review_submission'},
    'apps/campaign/target_area.py': {'generate_settlement_target_area', 'add_to_archive'},
    'apps/db_access/uuid_checker.py': {'record_exists', 'ReadDBData'},
    'apps/mlos/coord_review.py': set(),
    'apps/mlos/duplicate_checker.py': {'duplicate_deep_search_protocol', 'construct_new_unique', 'detect_unique_admin_field'},
    'apps/mlos/fixer.py': {'auto_shift_points', 'populate_global_id', 'populate_takeoff_point'},
    'apps/mlos/qc_mlos.py': {'standardize_mlos_records', 'construct_new_unique', 'detect_unique_admin_field'},
    'apps/mlos/standardizer.py': {'standardize_mlos_records'},
    'apps/mlos/update_validation.py': {'load_workbook', 'common_transformations', 'update_mlos', 'concat'},
    'apps/planfeld/dip.py': {'populate_daily_implementation_plan'},
    'apps/planfeld/dmp.py': {'extract_and_retrieve_datasets'},
    'apps/planfeld/dip_template.py': {'merge_maps_to_dips', 'extract_and_find_file', 'generate_team_dips',
                                      'validate_daily_implementation_plan', 'ExcelWriter'},
    'apps/tracking/reporter/campaign_day_reporting.py': {'generate_report', 'DailyReport'},
    'apps/tracking/reporter/post_implementation_report.py': {'generate_post_implementation_report'},
    'apps/tracking/reporter/timespent.py': {'execute_timespent_analysis'},
    # The library functions the routes await must do their work through run_heavy as well.
    'mlos/validation/review/run_validate.py': {'find_duplicate_attributes', 'run_spatial_checks', 'validate_attributes_entry',
                                               'review_attributes_consistency', 'duplicate_deep_search_protocol'},
    'mlos/validation/review/spatial/coordinate_reviewer.py': {'extract_places', 'create_review_datasets', 'run_settlement_similarity_check',
                                                              'investigate_similarity_response'},
    'campaign/contact_analysis.py': {'create_dataset', 'evaluate_contact', 'evaluate_settlement_contacts'},
    'target_area/buffer_target_area.py': {'fallback_voronoi', 'fallback_grids'},
}


def direct_calls(function: ast.AsyncFunctionDef):
    """Names of everything called by this function itself, not by functions defined inside it."""
    found = []

    def visit(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            if isinstance(child, ast.Call):
                target = child.func
                found.append(target.id if isinstance(target, ast.Name) else getattr(target, 'attr', None))
            visit(child)

    visit(function)
    return [name for name in found if name]


class TestNoAnalysisLeftOnTheEventLoop(unittest.TestCase):
    def test_every_async_function_hands_its_analysis_to_a_worker_thread(self):
        problems = []
        for relative, forbidden in ON_THE_LOOP_FORBIDDEN.items():
            source = (PACKAGE / relative).read_text(encoding='utf-8')
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.AsyncFunctionDef):
                    for name in direct_calls(node):
                        if name in forbidden:
                            problems.append(f'{relative}::{node.name} calls {name}() on the event loop')
        self.assertEqual(problems, [], '\n'.join(problems))

    def test_the_guard_can_tell_the_difference(self):
        """Control: the same check flags a route that still calls its analysis directly."""
        broken = ast.parse('async def route(data):\n    return populate_daily_implementation_plan(data)\n')
        fixed = ast.parse('async def route(data):\n    return await run_heavy(populate_daily_implementation_plan, data)\n')
        self.assertIn('populate_daily_implementation_plan', direct_calls(broken.body[0]))
        self.assertNotIn('populate_daily_implementation_plan', direct_calls(fixed.body[0]))

    def test_every_converted_file_imports_the_helper_it_uses(self):
        for relative in ON_THE_LOOP_FORBIDDEN:
            source = (PACKAGE / relative).read_text(encoding='utf-8')
            if 'run_heavy(' in source:
                self.assertIn('from toolbox.utils.offload import run_heavy', source, relative)
            if 'run_in_threadpool(' in source:
                self.assertIn('run_in_threadpool', source.split('run_in_threadpool(')[0], relative)


if __name__ == '__main__':
    unittest.main()
