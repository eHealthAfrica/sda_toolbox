import pandas as pd
from tqdm import tqdm
from typing import Any
from functools import cached_property, cache
from fuzzywuzzy import process

from toolbox.models import State, Policy
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.exceptions import DataError
from toolbox.mlos import get_admin_col, AdminColumns


def get_team_code(source_team_code: Any):
    if pd.isna(source_team_code):
        return None

    team_code = str(source_team_code).split("/")[-1]
    return team_code


def compare_admin_data(row: pd.Series, admin_col: str, admin_names: list) -> str:
    admin_name = row[admin_col]
    match = process.extractBests(admin_name, admin_names, score_cutoff=80, limit=1)
    if not match:
        return admin_name

    return match[0][0]


def standardize_admin_records(dataset: pd.DataFrame, purpose: Policy):
    print('Data Cleanup and Standardization of Validation Dataset')
    admin_cols = {
        level: get_admin_col(dataset, level) for level # noqa
        in ['state', 'lga', 'ward', 'settlement']
    }

    admin: AdminColumns = AdminColumns(**admin_cols)
    dataset = dataset.loc[dataset[admin.state].notna()]

    states = dataset[admin.state].unique().tolist()
    if len(states) != 1:
        raise DataError('expected only one state',
                        f'state information on {", ".join(states)} found')

    state: State = State[states[0].title()]
    ward_data: pd.DataFrame = ReadDBData(
        CONFIG['DATASETS']['ward_boundary'], False).read_data({'statecode': state.state_code})

    # Todo: make a copy of ward_boundary data and create 2 concatenations State_LGA and State_LGA_Ward for better comparison
    ward_col = get_admin_col(ward_data, 'ward')
    wards = ward_data[ward_col].unique().tolist()
    tqdm.pandas(desc='checking ward names')
    #Todo: figure out how to filter and pass wards within the same LGA
    dataset[admin.ward] = dataset.progress_apply(compare_admin_data, args=(admin.ward, wards), axis=1)
    team_col = CONFIG['REMAPPERS'][purpose.value]['team_code']
    dataset[team_col] = dataset[team_col].apply(get_team_code)

    lga_col = get_admin_col(ward_data, 'lga')
    lgas = ward_data[lga_col].unique().tolist()
    tqdm.pandas(desc='checking lga names')
    dataset[admin.lga] = dataset.progress_apply(compare_admin_data, args=(admin.lga, lgas), axis=1)
    dataset.drop_duplicates(subset='unique_code', keep='first', inplace=True)

    return dataset