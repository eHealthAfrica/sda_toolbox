import logging

import pandas as pd
import geopandas as gpd

from toolbox.campaign.campaign_tools import update_visitation, reassess_visitation
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.mlos import detect_unique_admin_field, construct_new_unique


def generate_ta_cumulative_summary(target_area: gpd.GeoDataFrame, unique_col: str) -> pd.DataFrame:
    """Generates the Visitation count summary from the Target Area Dataset using the Unique Column

    Args:
        target_area (gpd.GeoDataFrame): Gridded Target Area Dataset
        unique_col (str): Unique Admin Concatenated Column

    Returns:
        pd.DataFrame: DataFrame with the summary of Visited and Non-Visited Settlement grids
    """
    logging.info(f"Generating Summary of Visitation by {unique_col}")
    target_area.drop_duplicates(subset=['rowid', 'visitation'], inplace=True)
    cum_summary = (
        target_area.groupby(by=[unique_col, 'visitation'])
        .size()
        .reset_index(name='count')
        .pivot_table(values='count', columns='visitation', index=unique_col)
    )

    logging.info("Calculating Total")
    cum_summary.fillna(0, inplace=True)
    cum_summary["Total"] = cum_summary['Not Yet Visited'] + cum_summary['Visited']

    return cum_summary


def calculate_coverage(summary_data: pd.DataFrame) -> pd.DataFrame:
    """Sets the Visitation Status and Calculates Coverage"""
    logging.info('Calculating Settlement Coverage')
    summary_data['visitation'] = summary_data.apply(
        lambda row: 'Visited' if row['Visited']>=1 else 'Not Yet Visited', axis=1
    )

    summary_data['Coverage'] = summary_data['Visited']/summary_data['Total']
    return summary_data


def find_and_update_visited_grids(tracks: gpd.GeoDataFrame, target_area: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Identifies grid cells which intersect with tracks and updates the visitation status

    Args:
        tracks (gpd.GeoDataFrame): Tracks Data
        target_area (gpd.GeoDataFrame): Gridded TA Dataset

    Returns:
        gpd.GeoDataFrame: updated target area dataset
    """
    logging.info("Identifying Visited Grids")

    if 'rowid' not in target_area.columns:
        target_area['rowid'] = target_area.index + 1

    target_area_columns = target_area.columns.tolist() + ['index_tracks']
    if 'visitation' not in target_area_columns:
        target_area_columns += ['visitation']

    joined_2 = target_area.sjoin(tracks, how='left', predicate='intersects', rsuffix='tracks').reset_index()
    joined_2['cumm'] = joined_2.apply(lambda row: 'Visited' if pd.notna(row['index_tracks']) else 'Not Visited', axis=1)
    joined_2['visitation'] = joined_2.apply(update_visitation, axis=1)
    updated_ta = joined_2.loc[:, target_area_columns]

    return updated_ta


def gridded_settlement_visitation(tracks: gpd.GeoDataFrame, states: list[str]):
    datasets: dict = CONFIG['DATASETS']
    gridded_ta_data = ReadDBData(datasets['gridded_settlement_extent'], True).read_data({'state_name': states})
    gridded_ta_col: str | None = detect_unique_admin_field(gridded_ta_data)
    if not gridded_ta_col:
        gridded_ta_col: str = 'uniquecode'
        gridded_ta_data = construct_new_unique(gridded_ta_data, gridded_ta_col)

    if "index_tracks" in gridded_ta_data.columns:
        gridded_ta_data.drop(columns='index_tracks', inplace=True, errors='ignore')

    gridded_target_area = find_and_update_visited_grids(tracks, gridded_ta_data)
    cumulative_summary = generate_ta_cumulative_summary(gridded_target_area, gridded_ta_col)
    updated_cumulative_summary = calculate_coverage(cumulative_summary)

    return updated_cumulative_summary, gridded_ta_col