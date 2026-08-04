import concurrent.futures as cf
from functools import partial

import geopandas as gpd
from tqdm import tqdm
import pandas as pd

from toolbox import CPU_COUNT
from toolbox.models import State
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.mlos.mtools import concat_columns
from toolbox.triangulate.ttools import set_reach
from toolbox.mlos import get_admin_col, AdminColumns
from toolbox.mlos.validation.update.standardize import compare_admin_data
from toolbox.mlos.transformers.common import standardize_value, update_abbreviations


def cleanup_submission_admin_records(
        submission_datasets: dict[str, pd.DataFrame], unique_code: str, state_name: State)-> dict[str, pd.DataFrame]:

    usable_datasets = []
    ward_boundary_data = ReadDBData(
        CONFIG['DATASETS']['ward_boundary'], False).read_data({'statename': [state_name.value]})

    submission_datasets = tuple(submission_datasets.items())
    with cf.ProcessPoolExecutor(max_workers=CPU_COUNT) as executor:
        partial_cleaner = partial(
            clean_state_dataset, unique_code=unique_code, boundary=ward_boundary_data, state=state_name)
        results = executor.map(partial_cleaner, submission_datasets)

        for result in tqdm(results, total=len(submission_datasets), desc="Standardizing"):
            if result is None:
                continue
            usable_datasets.append(result)

    usable_datasets = {source: data for source, data in usable_datasets}
    print("Done Standardizing")
    return usable_datasets


def clean_state_dataset(
        submission_dataset: tuple[str, pd.DataFrame], unique_code: str,
        boundary: gpd.GeoDataFrame, state: State) -> None | tuple[str, pd.DataFrame]:

    source, dataset = submission_dataset
    dataset_admin_cols = {
        col: get_admin_col(dataset, col, 'ignore')
        for col in ['state', 'lga', 'ward', 'settlement']
    }

    if pd.isna([admin_col for admin_col in dataset_admin_cols.values()]).any():
        return None

    admin: AdminColumns = AdminColumns(**dataset_admin_cols)
    state_dataset = dataset.loc[dataset[admin.state].str.lower()==state.name.lower()]
    if state_dataset.empty:
        return None

    state_dataset[admin.state] = state.name.title()
    lga_col = get_admin_col(boundary, 'lga')
    ward_col = get_admin_col(boundary, 'ward')

    # print(f'Standardizing {source} Records...')
    for col, boundary_col in zip([admin.lga, admin.ward], [lga_col, ward_col]):
        state_dataset[col] = state_dataset.apply(
            compare_admin_data, args=(col, boundary[boundary_col].unique().tolist()), axis=1)

    state_dataset[admin.settlement] = state_dataset[admin.settlement].apply(standardize_value)
    state_dataset[admin.settlement] = state_dataset.apply(update_abbreviations, args=(admin.settlement,), axis=1)
    state_dataset[unique_code] = state_dataset.apply(concat_columns, args=(admin,), axis=1)
    state_dataset.dropna(subset=[unique_code], inplace=True)
    state_dataset.drop_duplicates(subset=unique_code, inplace=True)

    return source, state_dataset


def triangulate_by_settlement(
        settlement_list: pd.DataFrame, unique_col: str, submission_datasets: dict[str, pd.DataFrame], aoi: State)-> pd.DataFrame:
    """ Triangulate Settlement visitation by matching unique settlement codes from submission datasets """

    usable_datasets = cleanup_submission_admin_records(submission_datasets, unique_col, aoi)
    for source_name, dataset in tqdm(usable_datasets.items(), desc="By Settlement", total=len(usable_datasets)):
        dataset.reset_index(drop=False, inplace=True)
        settlement_list = settlement_list.merge(dataset[[unique_col, 'index']], how='left', left_on=unique_col,
                                                right_on=unique_col, validate='1:m', suffixes=('', f'_{source_name}'))

        settlement_list.drop_duplicates(subset=unique_col, keep='first', inplace=True)
        settlement_list = set_reach(settlement_list, 'index', source_name)
        settlement_list.drop(columns='index', inplace=True)

    return settlement_list