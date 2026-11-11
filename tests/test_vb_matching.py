"""Regression test for hardening item H3: vaccine-buddy devices were never matched.

tracks_cleanup() upper-cases every IMEI, but match_vb_team_code() looked for IMEIs starting
with lowercase 'vbu', so no device matched; and the function then returned its unmerged
rows, so the mapping was never applied even when something did match.

Run from the repo root:  python -m unittest tests.test_vb_matching -v
The module is loaded straight from its file with stand-ins for geopandas, shapely, geopy and
the toolbox helpers, because importing toolbox.campaign pulls in the whole application
(database, spatial libraries). The functions under test use pandas only.
"""
import importlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path

import pandas as pd

MODULE = Path(__file__).resolve().parents[1] / 'src' / 'toolbox' / 'campaign' / 'team_reviewer' / 'team_reviewer_utils.py'


def _stand_in(name, **attributes):
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    return module


def load_module():
    """team_reviewer_utils with any dependency that is not installed replaced by a stand-in."""
    stand_ins = {
        'geopandas': _stand_in('geopandas', GeoDataFrame=pd.DataFrame),
        'shapely': _stand_in('shapely'),
        'shapely.geometry': _stand_in('shapely.geometry', Point=object),
        'geopy': _stand_in('geopy'),
        'geopy.distance': _stand_in('geopy.distance', geodesic=lambda *a, **k: None),
        'toolbox': _stand_in('toolbox'),
        'toolbox.tools': _stand_in('toolbox.tools', is_empty=lambda v: pd.isna(v) or v == 0 or v == ''),
        'toolbox.access': _stand_in('toolbox.access'),
        'toolbox.access.read': _stand_in('toolbox.access.read', ReadDBData=object),
    }
    added = []
    for name, module in stand_ins.items():
        try:
            importlib.import_module(name)
        except Exception:
            sys.modules[name] = module
            added.append(name)
    try:
        spec = importlib.util.spec_from_file_location('team_reviewer_utils_under_test', MODULE)
        loaded = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loaded)
        return loaded
    finally:
        for name in added:
            sys.modules.pop(name, None)


utils = load_module()


def tracks(imeis, codes=None):
    codes = codes or ['KN-ABC-DEF1-CMP-001'] * len(imeis)
    return pd.DataFrame({'IMEI': imeis, 'Team Code': codes, 'Lat': range(len(imeis))})


def mapping(rows):
    return pd.DataFrame(rows, columns=['DEVICE ID', 'TEAM'])


class VaccineBuddyMatching(unittest.TestCase):
    def test_upper_case_imei_is_matched(self):
        result = utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]), tracks(['VBU-123', '860001']))
        self.assertEqual(list(result['Team Code']), ['KN-XYZ-ABC1-CMP-007', 'KN-ABC-DEF1-CMP-001'])

    def test_lower_case_imei_is_matched_too(self):
        result = utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]), tracks(['vbu-123']))
        self.assertEqual(result.loc[0, 'Team Code'], 'KN-XYZ-ABC1-CMP-007')

    def test_device_ids_match_whatever_their_case_or_padding(self):
        result = utils.match_vb_team_code(mapping([(' ab12 ', 'KN-XYZ-ABC1-CMP-007')]), tracks(['VBU-AB12', 'vbu-Ab12']))
        self.assertEqual(set(result['Team Code']), {'KN-XYZ-ABC1-CMP-007'})

    def test_the_mapped_code_gets_the_same_clean_up_as_other_team_codes(self):
        result = utils.match_vb_team_code(mapping([('1', 'kn/xyz_abc1 -cmp-007')]), tracks(['VBU-1']))
        self.assertEqual(result.loc[0, 'Team Code'], 'KN-XYZ-ABC1-CMP-007')

    def test_imei_and_row_order_are_left_alone(self):
        data = tracks(['860001', 'VBU-123', '860002'])
        result = utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]), data)
        self.assertEqual(list(result['IMEI']), ['860001', 'VBU-123', '860002'])
        self.assertEqual(list(result['Lat']), [0, 1, 2])
        self.assertEqual(list(result.index), [0, 1, 2])

    def test_the_input_is_not_modified(self):
        data = tracks(['VBU-123'])
        utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]), data)
        self.assertEqual(data.loc[0, 'Team Code'], 'KN-ABC-DEF1-CMP-001')

    def test_unlisted_devices_keep_their_own_team_code(self):
        result = utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]),
                                          tracks(['VBU-999'], ['KN-OWN-CODE-CMP-002']))
        self.assertEqual(result.loc[0, 'Team Code'], 'KN-OWN-CODE-CMP-002')

    def test_a_blank_team_in_the_mapping_changes_nothing(self):
        result = utils.match_vb_team_code(mapping([('123', None), ('124', '  ')]),
                                          tracks(['VBU-123', 'VBU-124'], ['A', 'B']))
        self.assertEqual(list(result['Team Code']), ['A', 'B'])

    def test_a_repeated_device_in_the_mapping_does_not_duplicate_rows(self):
        result = utils.match_vb_team_code(
            mapping([('123', 'KN-FIRST-AAA1-CMP-001'), ('123', 'KN-SECOND-BBB1-CMP-002')]), tracks(['VBU-123']))
        self.assertEqual(len(result), 1)
        self.assertEqual(result.loc[0, 'Team Code'], 'KN-FIRST-AAA1-CMP-001')

    def test_no_vaccine_buddy_devices_returns_the_tracks_unchanged(self):
        data = tracks(['860001', '860002'])
        result = utils.match_vb_team_code(mapping([('123', 'X')]), data)
        self.assertTrue(result.equals(data))

    def test_works_after_tracks_cleanup_has_upper_cased_the_imei(self):
        cleaned = tracks(['vbu-123 ', 'x'])
        cleaned['IMEI'] = cleaned['IMEI'].str.upper().str.replace(r'\s+', '', regex=True)
        result = utils.match_vb_team_code(mapping([('123', 'KN-XYZ-ABC1-CMP-007')]), cleaned)
        self.assertEqual(result.loc[0, 'Team Code'], 'KN-XYZ-ABC1-CMP-007')


if __name__ == '__main__':
    unittest.main()
