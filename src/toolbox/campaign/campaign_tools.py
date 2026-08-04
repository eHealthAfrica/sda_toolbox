import re
import logging
from typing import List, Literal
import concurrent.futures

import numpy as np
import pandas as pd
import geopandas as gpd

from toolbox import CPU_COUNT
from toolbox.configs import CONFIG
from toolbox.models import CampaignDay
from toolbox.spatial_mgr import GeomColumns
from toolbox.exceptions import DataError, NotFoundError
from toolbox.mlos.transformers.common import standardize_column_names
from toolbox.tools import is_empty


def update_dip_visitation(dip_data: pd.DataFrame, campaign_day: CampaignDay):
    updated_dip = set_cumulative_visitation(dip_data, campaign_day.analysis_day)
    logging.info(f"Updating Visitation and Final Coverage for Day {campaign_day.analysis_day}")
    day_col = detect_day_column(campaign_day.analysis_day, updated_dip)
    updated_dip[day_col] = updated_dip.apply(
        update_day_visitation, args=(campaign_day.analysis_day, day_col),
        axis=1)

    cum_col = f'day_{campaign_day.analysis_day}_cumm'
    if campaign_day.is_mop_up:
        updated_dip.loc[updated_dip[cum_col]=='Not Yet Visited', [cum_col]] = 'Not Visited'

    return updated_dip, day_col, cum_col


def group_data(data: gpd.GeoDataFrame | pd.DataFrame, column: str | List[str], ranking: List[int]=None) -> list[pd.DataFrame]:
    """Create grouping of a dataset by a specified column"""
    logging.info(f'Grouping Dataset by {column}')
    if isinstance(column, str):
        column = [column]

    elif isinstance(column, list) and not ranking:
        column = column

    elif len(column) == len(ranking):
        grouping = [(col, rank) for col, rank in zip(column, ranking)]
        column = [col[0] for col in sorted(grouping, key=lambda x: x[1], reverse=True)]
    else:
        logging.error('ranking and column list parameter sizes do not match')
        raise DataError('Mismatched parameters', 'Sizes of columns and ranking do not match')

    grouping = data.groupby(by=column)
    groups = [group for _, group in grouping]
    return groups


def transfer_coordinates(dataset: pd.DataFrame, data_geo: GeomColumns, m_geo_col: GeomColumns) -> pd.DataFrame:
    if not data_geo.latitude:
        return dataset
    
    new_y, new_x = f"{m_geo_col.latitude}_y", f"{m_geo_col.longitude}_y"
    dataset[data_geo.latitude] = dataset[new_y]
    dataset[data_geo.longitude] = dataset[new_x]
    dataset.drop(columns=[new_x, new_y], inplace=True)
    return dataset


def detect_day_column(day: int, data: pd.DataFrame, not_found: Literal['ignore', 'raise']='raise') -> str | None:
    """Detects the Column that matches the analysis day"""
    # Todo: Modify to get all viable options and limit findings to columns that include day but not cumm
    logging.info(f'Searching for columns that matches Day {day}')
    columns = [col for col in data.columns]

    for col in columns:
        match = re.search(rf'{CONFIG.get("REGEX").get("NUM_PATTERN")}', col, re.IGNORECASE)
        if not match:
            continue

        if int(match.group()) == day:
            return col

    if not_found == 'ignore':
        return None
    
    raise NotFoundError('Day column Not Found', 'No column matches the provided day information')


def update_visitation(row: pd.Series, prev_day_cumm: str | None = 'cumm') -> str | None:
    prev_status = row.get(prev_day_cumm, None)
    current_status = row.get('visitation', None)

    stats = [prev_status, current_status]

    if any([status=='Visited' for status in stats]):
        return 'Visited'

    if all([pd.isna(status) for status in stats]):
        return None

    return 'Not Yet Visited'


def get_cumulative_day_cols(day: int, data: pd.DataFrame):
    if day > 1:
        cumulative_day_cols = [detect_day_column(i, data) for i in range(1, day+1)]
    else:
        cumulative_day_cols = [detect_day_column(day, data)]

    return cumulative_day_cols


def update_cumulative_dip_visitation(data: pd.DataFrame, day: int) -> pd.DataFrame:
    """Identifies all previous days from the current analysis day and updates the cumulative visitation status

    Args:
        data (pd.DataFrame):Campaign settlement DataFrame
        day (int): Day of the current analysis

    Returns:
        pd.DataFrame: Updated Campaign Settlements data

    """

    logging.info(f'Identifying all planned settlements for upto day {day}')
    cumulative_day_cols = get_cumulative_day_cols(day, data)
    data = standardize_column_names(data, cumulative_day_cols)

    cumulative_day_cols = get_cumulative_day_cols(day, data)
    query  = " | ".join([f"({col}.notnull())" for col in cumulative_day_cols])
    data.eval(f"is_cumm={query}", engine='python', inplace=True)
    logging.info(f"Setting Cumulative Visitation for Day {day}")
    data[f'day_{day}_cumm'] = data.apply(
        lambda row: row['visitation'] if (row['is_cumm'] is True) or (pd.notna(row['visitation']))
        else np.nan, axis=1
    )
    
    return data


def update_day_visitation(row: pd.Series, campaign_day: int, day_col: str) -> str | None:
    campaign_day_status: str | None = row.get(f'day_{campaign_day}_cumm')
    day_val: str | None = row[day_col]
    if pd.isnull(day_val) or day_val is None:
        return None

    day_value = day_val.strip()
    if day_value and campaign_day_status is None:
        return None

    return campaign_day_status


def final_coverage_update(row: pd.Series) -> float:
    coverage: float = row['Coverage']
    prev_coverage: float = row['Prev_Coverage']

    if pd.notna(coverage) and pd.notna(prev_coverage):
        return max([coverage, prev_coverage])

    if pd.notna(coverage) and pd.isna(prev_coverage):
        return coverage

    if pd.isna(coverage) and pd.notna(prev_coverage):
        return prev_coverage

    return np.nan


def validate_group(grouped_data: pd.DataFrame, primary_col: str) -> pd.DataFrame:

    if grouped_data['index_right'].any():
        grouped_data['visitation'] = 'Visited'
    else:
        grouped_data['visitation'] = 'Not Yet Visited'

    grouped_data.drop_duplicates(subset=primary_col, keep='first', inplace=True)
    return grouped_data


def validate_with_buffered_tracks(site_groups: list[pd.DataFrame], unique_code: str) -> pd.DataFrame:
    logging.info('Validating Settlements using Buffer protocols')
    processed = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=CPU_COUNT) as executor:
        futures = [executor.submit(validate_group, group, unique_code) for group in site_groups]

        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            processed.append(result)

    processed_df = pd.concat(processed, ignore_index=True)
    return processed_df


def set_cumulative_visitation(dip_data: pd.DataFrame, campaign_day: int) -> pd.DataFrame:
    logging.info('Setting Final Visitation and Cumulative Visitation to DIP')
    prev_cumulative = f'day_{campaign_day - 1}_cumm' if campaign_day > 1 else None
    dip_data['visitation'] = dip_data.apply(update_visitation, args=(prev_cumulative,), axis=1)
    updated_dip_data = update_cumulative_dip_visitation(dip_data, campaign_day)
    return updated_dip_data


def classify_results(data: pd.DataFrame):
    """Classifies Tracking Reports"""
    import time
    print('Classifying Tracking Results')
    # mapper = CONFIG['COVERAGE_CLASSIFIER']
    data['Settlement Coverage'] = data.apply(classify_coverage, axis=1)
    data['Time Spent'] = data.apply(classify_time_spent, axis=1)
    return data


def classify_coverage(row: pd.Series) -> str:
    coverage: float = row['Coverage']
    if is_empty(coverage):
        return 'No Coverage'

    coverage = round(coverage, 2)
    ranges = {
        # (0.01, 0.30): 'Very Low Coverage',
        (0.01, 0.50): 'Poorly Covered',
        (0.50, 0.80): 'Partially Covered',
        (0.80, 1.0): 'Fully Covered'
    }

    for range_vals, classification in ranges.items():
        if (coverage >= range_vals[0]) and (range_vals[1] > coverage):
            return classification

    return 'Fully Covered'


def classify_time_spent(row: pd.Series):
    tracks = row['track_count']
    if is_empty(tracks):
        return np.nan

    time_spent_mins = tracks * 2

    ranges = {
        (1, 12): '<12 mins',
        (13, 30): '12 - 30 mins',
        (31, 60): '30 mins - 1 hr',
        (61, 120): '1 - 2 hrs',
    }

    for range_vals, classification in ranges.items():
        if range_vals[0] <= time_spent_mins <= range_vals[1]:
            return classification

    return '>2 hrs'