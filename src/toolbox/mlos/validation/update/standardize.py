import pandas as pd
from tqdm import tqdm
from typing import Any
import geopandas as gpd
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


def compare_admin_data_ii(record_admin:str, admin_names: list) -> str:
    match = process.extractBests(record_admin, admin_names, score_cutoff=80, limit=1)
    if not match:
        return record_admin

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


def standardize_admin(dataset: gpd.GeoDataFrame | pd.DataFrame, admin: AdminColumns | None) -> gpd.GeoDataFrame | pd.DataFrame:
    admin = admin if admin else AdminColumns.create_by_search(dataset)
    admin_columns = admin.__dict__
    for level, admin_col in admin_columns.items():
        dataset[admin_col] = dataset[admin_col].str.title().str.replace('_', '-')

    return dataset


def standardize_admin_records_to_boundary(dataset: pd.DataFrame, admin: AdminColumns, boundary: pd.DataFrame) -> pd.DataFrame:
    dataset = standardize_admin(dataset, admin)

    dataset['unique_attribute'] = dataset.apply(
        lambda row: f"{row[admin.state]}*{row[admin.lga]}", axis=1)

    boundary['unique_admin'] = boundary.apply(
        lambda row: f"{row['statename']}*{row['lganame']}", axis=1)

    unique_lgas = dataset['unique_attribute'].unique().tolist()
    state_lgas = boundary["unique_admin"].unique().tolist()
    lga_renamer = {lga: compare_admin_data_ii(lga, state_lgas) for lga in unique_lgas}
    dataset['unique_attribute'] = dataset['unique_attribute'].map(lga_renamer)
    dataset['unique_attribute'] = dataset['unique_attribute'].str.split('*')
    dataset[admin.lga] = dataset['unique_attribute'].str[-1]

    dataset['unique_attribute'] = dataset.apply(
        lambda row: f"{'*'.join(row['unique_attribute'])}*{row[admin.ward]}", axis=1)

    boundary['unique_admin'] = boundary.apply(
        lambda row: f"{row["unique_admin"]}*{row["wardname"]}", axis=1)

    unique_data_ward = dataset['unique_attribute'].unique().tolist()
    unique_boundary_wards = boundary['unique_admin'].unique().tolist()
    ward_renamer = {ward: compare_admin_data_ii(ward, unique_boundary_wards) for ward in unique_data_ward}
    dataset['unique_attribute'] = dataset['unique_attribute'].map(ward_renamer)
    dataset['unique_attribute'] = dataset['unique_attribute'].str.split('*')
    dataset[admin.ward] = dataset['unique_attribute'].str[-1]

    cleaned_dataset = dataset.drop(columns='unique_attribute')

    return cleaned_dataset