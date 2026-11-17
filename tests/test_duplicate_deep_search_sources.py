"""The duplicate search with 'Cross-reference source' on must return the source of both settlements of every pair.

Run from the repo root:  python -m unittest tests.test_duplicate_deep_search_sources -v
deep_search.py is loaded straight from its file with stand-ins for the fuzzy matcher, the distance library and
the toolbox packages; pandas is real.
"""
import difflib
import math
import types
import unittest

import pandas as pd

from tests import test_reliability  # noqa: F401  (puts the package on sys.path)
from tests.test_h7_readers import load, stand_in


class DataError(Exception):
    pass


class MissingConfiguration(DataError):
    pass


class Geom:
    def __init__(self, latitude, longitude):
        self.latitude, self.longitude = latitude, longitude


def token_sort_ratio(a, b):
    a, b = ' '.join(sorted(a.lower().split())), ' '.join(sorted(b.lower().split()))
    return round(100 * difflib.SequenceMatcher(None, a, b).ratio())


def geodesic(a, b):
    radius = 6371000
    p1, p2, dl = math.radians(a[0]), math.radians(b[0]), math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return types.SimpleNamespace(meters=2 * radius * math.asin(math.sqrt(h)))


def deep_search():
    stubs = {
        'fuzzywuzzy': stand_in('fuzzywuzzy', fuzz=types.SimpleNamespace(token_sort_ratio=token_sort_ratio)),
        'geopy': stand_in('geopy'),
        'geopy.distance': stand_in('geopy.distance', geodesic=geodesic),
        'tqdm': stand_in('tqdm', tqdm=lambda items, **_k: items),
        'toolbox': stand_in('toolbox', CPU_COUNT=2),
        'toolbox.utils': stand_in('toolbox.utils', timer=lambda **_k: (lambda fn: fn)),
        'toolbox.configs': stand_in('toolbox.configs', CONFIG={'THRESHOLDS': {'INTRA-WARD': 92}}),
        'toolbox.mlos': stand_in('toolbox.mlos', get_admin_col=lambda _df, level: level),
        'toolbox.tools': stand_in('toolbox.tools', coords_are_valid=lambda c: len(c) == 2 and all(v == v for p in c for v in p)),
        'toolbox.spatial_mgr': stand_in('toolbox.spatial_mgr', GeomColumns=Geom),
        'toolbox.exceptions': stand_in('toolbox.exceptions', MissingConfiguration=MissingConfiguration, DataError=DataError),
    }
    return load('mlos/validation/review/attributes/deep_search.py', stubs)


def settlements(sources):
    names = ['Gwale', 'Gwalee', 'Tudun', 'Tudunn']
    coords = [(12.0, 8.5), (12.0, 8.5001), (12.1, 8.6), (12.1, 8.60001)]
    frame = pd.DataFrame({
        'state': 'Kano', 'lga': 'Dala', 'ward': 'Ward1',
        'unique_code': [f'Kano_Dala_Ward1_{n}' for n in names],
        'lat': [c[0] for c in coords], 'lon': [c[1] for c in coords],
        'Source': sources,
    })
    return frame


def run(frame, cross):
    module = deep_search()
    return module.duplicate_deep_search_protocol(frame, 'unique_code', 80, Geom('lat', 'lon'), 'mapping', cross)


def pairs(result):
    return result[['settlement 1', 'settlement 2', 'source1', 'source2']].values.tolist()


class TestSourcesAreReturned(unittest.TestCase):
    def test_both_sources_come_back_for_every_pair(self):
        result = run(settlements(['GRID3', 'MLoS', 'GRID3', 'MLoS']), True)
        self.assertEqual(pairs(result), [['Gwale', 'Gwalee', 'GRID3', 'MLoS'], ['Tudun', 'Tudunn', 'GRID3', 'MLoS']])

    def test_off_leaves_the_source_columns_empty(self):
        result = run(settlements(['GRID3', 'MLoS', 'GRID3', 'MLoS']), False)
        self.assertEqual(list(result.columns[-2:]), ['source1', 'source2'])
        self.assertTrue(result['source1'].isna().all() and result['source2'].isna().all())

    def test_an_empty_source_cell_no_longer_breaks_the_search(self):
        result = run(settlements(['GRID3', None, float('nan'), 'MLoS']), True)
        self.assertEqual(pairs(result), [['Gwale', 'Gwalee', 'GRID3', ''], ['Tudun', 'Tudunn', '', 'MLoS']])

    def test_numeric_sources_are_written_as_text(self):
        result = run(settlements([1, 2, 3, 4]), True)
        self.assertEqual(pairs(result), [['Gwale', 'Gwalee', '1', '2'], ['Tudun', 'Tudunn', '3', '4']])


class TestEachPairOnce(unittest.TestCase):
    def test_a_pair_is_not_reported_again_the_other_way_round(self):
        result = run(settlements(['a', 'b', 'c', 'd']), True)
        self.assertEqual(len(result), 2)
        seen = {frozenset(p[:2]) for p in pairs(result)}
        self.assertEqual(len(seen), 2)

    def test_manage_checked_pairs_returns_the_two_names_of_each_record(self):
        module = deep_search()
        records = [['a', 'b', 'Duplicate Review', 95, 3.0, 'x', 'y'], ['c', 'd', 'Duplicate Remove', 99, None, '', '']]
        self.assertEqual(module.manage_checked_pairs(records), [['a', 'b'], ['c', 'd']])


if __name__ == '__main__':
    unittest.main()
