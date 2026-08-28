from fuzzywuzzy import fuzz
import pandas as pd

from toolbox.models import State
from toolbox.access import ReadDBData
from toolbox.mlos import get_admin_col, AdminColumns
from toolbox.spatial_mgr import GeomColumns, convert_to_geodata


def compare_admin_info(text1, text2):
    if pd.isna([text1, text2]).any():
        return None

    text1 = text1.lower()
    text2 = text2.lower()

    ratio = fuzz.token_sort_ratio(text1, text2)
    if ratio >= 95:
        return 'pass'

    return 'fail'


def review_submission(campaign_dataset: pd.DataFrame, state: State) -> pd.DataFrame:

    geom_columns = GeomColumns.get_geom_cols(campaign_dataset, True)
    campaign_geodata = convert_to_geodata(campaign_dataset, geom_columns)

    admin_map = {
        admin: get_admin_col(campaign_geodata, admin_type=admin)
        for admin in ['state', 'lga', 'ward', 'settlement']
    }

    for admin, col in admin_map.items():
        campaign_geodata[col] = campaign_geodata[col].str.title().str.strip()

    admin_cols: AdminColumns = AdminColumns(**admin_map)
    state_data = campaign_geodata.loc[campaign_geodata[admin_cols.state].str.lower() == state.value.lower()]
    ward_data = ReadDBData('wards', True).read_data({'statecode': state.state_code})

    enriched_data = state_data.sjoin(ward_data[['lganame', 'wardname', 'geometry']], how="left", predicate='within')
    enriched_data['wrong_lga'] = enriched_data.apply(
        lambda row: compare_admin_info(row[admin_cols.lga], row['lganame']), axis=1)

    enriched_data['wrong_ward'] = enriched_data.apply(
        lambda row: compare_admin_info(row[admin_cols.ward], row['wardname']), axis=1)

    passed_data = enriched_data.loc[
        (enriched_data['wrong_lga']=='pass')
        & (enriched_data['wrong_ward']=='pass')
    ]

    passed_data[admin_cols.lga] = passed_data['lganame']
    passed_data[admin_cols.ward] = passed_data['wardname']
    passed_data.drop(
        columns=['geometry', 'index_right', 'wardname', 'lganame', 'wrong_lga', 'wrong_ward'],
        inplace=True, errors='ignore'
    )

    print(f"""
    Total Dataset Submissions: {len(state_data)}\n
    Validated Dataset Submissions: {len(passed_data)}\n
    Failed QC Submissions: {len(state_data) - len(passed_data)}
    """
    )

    return passed_data
