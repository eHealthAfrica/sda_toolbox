from itertools import permutations, chain
from collections.abc import Iterable
from functools import lru_cache
from typing import Literal
import concurrent.futures
from enum import Enum
import logging
import re

import pandas as pd
from tqdm import tqdm
from fuzzywuzzy import fuzz
from geopy.distance import geodesic

from toolbox import CPU_COUNT
from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.mlos import get_admin_col
from toolbox.tools import coords_are_valid
from toolbox.spatial_mgr import GeomColumns
from toolbox.exceptions import MissingConfiguration


class DuplicateType(Enum):
    IS_SAME = 1
    IS_SIMILAR = 2
    NOT_DUPLICATE = 3
    IS_MIXED = 4


def flatten_issues_data(data: list[list[tuple[str, ...]]]):
    actions = {}
    removing = []
    reviewing = []
    potential = []
    for ward_data in data:
        for issue_result in ward_data:
            action = issue_result[-3]
            settlements = list(issue_result[:-3])
            if action == 'Duplicate Remove':
                removing.extend(settlements)
            elif action == 'Potential Duplicate Review':
                potential.extend(settlements)
            else:
                reviewing.extend(settlements)

    actions['remove'] = list(set(removing))
    actions['review'] = list(set(reviewing))
    actions['potential'] = list(set(potential))
    return actions


def group_settlement_by_admin(master_data: pd.DataFrame, unique_col: str)-> list[list[str]]:
    state, lga_col, ward_col  = [get_admin_col(master_data, lvl) for lvl in ['state', 'lga', 'ward']]
    master_data['ward_code'] = master_data.apply(lambda row: f"{row[lga_col]}_{row[ward_col]}", axis=1)
    admin_column = "ward_code"

    master_data_admin_grouping: list[pd.DataFrame] = [
        group for _, group
        in master_data.groupby(admin_column)
    ]

    return [
        ward[unique_col].tolist() for ward
        in master_data_admin_grouping
    ]


def parse_unique_settlement_name(record: str):
    """Generates a new settlement name from the provided record

    Args:
        record (str): Settlement Name

    Returns:
        str: New Settlement Name
    """
    if not isinstance(record, str):
        raise ValueError('Settlement name must be a string')

    return record.split('_')[-1]


def has_suffix(text: str) -> bool:
    pattern = r'\b(?:[A-Z]|[1-9]|(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))\b'
    return bool(re.search(pattern, text, re.IGNORECASE))


@lru_cache
def direct_compare_settlements(*settlements, threshold: int) -> tuple[DuplicateType, int]:
    logging.info('Settlement pair similarity test')
    settlement_1, settlement_2 = settlements
    if settlement_1 == settlement_2:
        return DuplicateType.IS_SAME, 100

    score = fuzz.token_sort_ratio(settlement_1, settlement_2)
    if any(has_suffix(set_name) for set_name in [settlement_1, settlement_2]):
        return DuplicateType.NOT_DUPLICATE, score

    if score >= threshold:
        return DuplicateType.IS_SIMILAR, score

    return DuplicateType.NOT_DUPLICATE, score


def update_master_data(master_data: pd.DataFrame, admin_col: str, settlement_action_map: dict[str, list[str]]):
    for action, settlements in settlement_action_map.items():
        master_data.loc[master_data[admin_col].isin(settlements), ['Action']] = action

    return master_data


def manage_checked_pairs(reviewed_pairs: list):
    ls = list(chain.from_iterable(reviewed_pairs))
    return [
        ls[i: i + 2]
        for i in range(0, len(ls), 5)
    ]


def review_ward_settlement_for_duplicates(
        pairing: Iterable, master_data: pd.DataFrame,
        unique_col: str, geo_cols: GeomColumns | None, threshold: int)-> list | None:

    checked_pair = []
    skipped = 0
    for pair in tqdm(list(pairing), desc="Comparing Ward Settlement Pairs"):
        pair = list(pair)
        reversed_pair = pair[::-1]
        collected = manage_checked_pairs(checked_pair)
        if reversed_pair in collected:
            skipped += 1
            continue

        settlements = [parse_unique_settlement_name(element) for element in pair]
        threshold = threshold if threshold else CONFIG['THRESHOLDS']['INTRA-WARD']
        duplicate_type, score = direct_compare_settlements(*settlements, threshold=threshold)
        if duplicate_type == DuplicateType.NOT_DUPLICATE:
            continue

        if geo_cols is None:
            pair += ['Duplicate Review', score, None]
            checked_pair.append(pair)
            continue

        coords: list[list[float]] = master_data.loc[
            master_data[unique_col].isin(pair), [geo_cols.latitude, geo_cols.longitude]].values.tolist()
        if not coords_are_valid(coords):
            pair += ['Duplicate Review', score, None]
            checked_pair.append(pair)
            continue

        coord_1, coord_2 = coords
        distance_meters = round(geodesic(coord_1, coord_2).meters, 3)

        if distance_meters > 65:
            pair += ['Unlikely Potential Duplicate Review', score, distance_meters]

        elif 10 < distance_meters < 65:
            pair += ['Duplicate Review', score, distance_meters]

        else:
            pair += ['Duplicate Remove', score, distance_meters]

        checked_pair.append(pair)

    return checked_pair if len(checked_pair) >= 1 else None


@timer(display=True)
def duplicate_deep_search_protocol(
        dataset: pd.DataFrame, unique_admin_col: str, threshold: int,
        geom_cols: GeomColumns, output: Literal['update', 'mapping']) -> pd.DataFrame:

    try:
        logging.info('Using similarity protocol for duplicate search')
        unique_ward_grouping: list[list] = group_settlement_by_admin(dataset, unique_admin_col)
        permutation_ward_settlement_grouping = [
            permutations(admin_group, 2) for admin_group
            in unique_ward_grouping
        ]

        geom_cols = geom_cols if geom_cols.latitude is not None else None

        checked = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=CPU_COUNT) as executor:
            futures = [
                executor.submit(
                    review_ward_settlement_for_duplicates, ward_pair, dataset,
                    unique_admin_col, geom_cols, threshold
                )

                for ward_pair in permutation_ward_settlement_grouping
            ]

            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                checked.append(result)

        final_checked = [data for data in checked if data is not None]

        if output == 'update':
            action_map = flatten_issues_data(final_checked)
            checked_mlos = update_master_data(dataset, unique_admin_col, action_map)
            return checked_mlos
        else:
            return generate_mapping_table(final_checked)

    except KeyError as e:
        raise MissingConfiguration('Missing Config Info', f'{e}')


def generate_mapping_table(reviewed_data: list[tuple[str,...]])-> pd.DataFrame:
    columns = ['settlement 1', 'settlement 2', 'review', 'score', 'distance']
    reviewed_data = [outcome for outcome in reviewed_data if outcome is not None]
    flattened_data = chain.from_iterable(reviewed_data)
    reviewed_df = pd.DataFrame.from_records(flattened_data, columns=columns)
    reviewed_df['score'] = reviewed_df['score'].astype(int)
    reviewed_df['distance'] = reviewed_df['distance'].astype(float)
    reviewed_df['admin_names'] = reviewed_df['settlement 1'].str.split('_')
    index_map = {0: 'state', 1: 'lga', 2: 'ward'}

    for idx, col_name in index_map.items():
        reviewed_df[col_name] = reviewed_df.apply(lambda row: row['admin_names'][idx], axis=1)

    reviewed_df['settlement 1'] = reviewed_df['settlement 1'].apply(parse_unique_settlement_name)
    reviewed_df['settlement 2'] = reviewed_df['settlement 2'].apply(parse_unique_settlement_name)

    return reviewed_df.loc[:,
    ['state', 'lga', 'ward', 'settlement 1', 'settlement 2', 'score', 'distance', 'review']
    ].sort_values(by=['state', 'lga', 'ward', 'settlement 1', 'settlement 2'])


if __name__ == '__main__':
    df = pd.read_csv(
        r"C:\Users\enyinnaya.nwaiwu\Downloads\20260909_Migrant Sites Linelist_vFinal.xlsx - Final Migrant Sites.csv")
    # isolate duplicated and add concatenate into result
    df_checked = duplicate_deep_search_protocol(
        df,
        threshold=92,
        unique_admin_col='unique_code',
        geom_cols=GeomColumns(latitude='LATITUDE', longitude='LONGITUDE'),
        output='mapping'
    )

    df_checked.to_csv(r"C:\Workspace\MIGRANT MAPPING\Migrant Sites_Potential Duplicates.csv", index=False)
