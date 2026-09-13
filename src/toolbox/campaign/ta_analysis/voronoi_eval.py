import logging

import pandas as pd
import geopandas as gpd

from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.mlos import detect_unique_admin_field, construct_new_unique


def count_tracks_within_settlement_extent(
        settlement_extent: gpd.GeoDataFrame, tracks: gpd.GeoDataFrame, unique_col: str) -> pd.DataFrame:
    """Counts the number of tracks that intersect with the settlement extent in the gridded target area"""
    logging.info('Counting Tracks Within Settlement Extent')

    extent_tracks = tracks.sjoin(settlement_extent, how='left', predicate='intersects', rsuffix='tracks')
    count = extent_tracks.groupby(by=unique_col).size()
    settlement_extent['track_count'] = settlement_extent[unique_col].map(count).fillna(0).astype(int)
    settlement_extent =  settlement_extent[[unique_col, 'eha_guid', 'track_count', 'geometry']].to_crs(32632)

    settlement_extent['area_sqm'] = settlement_extent.area
    return settlement_extent.drop(columns='geometry')


def settlement_voronoi_visitation(tracks: gpd.GeoDataFrame, states: list[str]) -> tuple[pd.DataFrame, str]:
    datasets: dict = CONFIG['DATASETS']
    ta_data = ReadDBData(datasets['settlement_extent'], True).read_data({'state_name': states})
    ta_col: str | None = detect_unique_admin_field(ta_data)
    if not ta_col:
        ta_col: str = 'uniquecode'
        ta_data = construct_new_unique(ta_data, ta_col)

    tracks_count_summary = count_tracks_within_settlement_extent(ta_data, tracks, ta_col)
    tracks_count_summary['track_count'].fillna(0, inplace=True)

    return tracks_count_summary, ta_col