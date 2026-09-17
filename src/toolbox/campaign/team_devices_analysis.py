from datetime import datetime, timedelta
from typing import Literal

import pandas as pd
import geopandas as gpd

from toolbox.access import ReadDBData
from toolbox.mlos import get_admin_col
from toolbox.tools import is_empty


def clean_up_tracks(tracks_data: gpd.GeoDataFrame, start_date: datetime, end_date: datetime) -> gpd.GeoDataFrame:

    tracks_data['track_date'] = tracks_data['timestamp'].dt.date
    valid_tracks = tracks_data.loc[tracks_data['track_date'].between(start_date, end_date, inclusive='both')]
    valid_tracks['Team Code'] = valid_tracks['Team Code'].str.upper().str.replace(r'\s+', '', regex=True)
    valid_tracks['IMEI'] = valid_tracks['IMEI'].str.lower().str.replace(r'\s+', '', regex=True)

    return valid_tracks

async def review_tracks_data(
        tracks: gpd.GeoDataFrame, team_allocation: pd.DataFrame,
        lvl: Literal['lga', 'ward'], start_date: datetime, duration: int):
    end_date = timedelta(days=duration) + start_date
    state_col = get_admin_col(team_allocation, 'state', 'raise')
    states = team_allocation[state_col].unique().tolist()

    valid_tracks = clean_up_tracks(tracks, start_date, end_date)
    ward_boundary = ReadDBData('wards', True).read_data({'statename': states})
    enriched_tracks = valid_tracks.sjoin(
        ward_boundary[['geometry', 'statename', 'lganame', 'wardname']],
        how='left',
        predicate='intersects'
    )

    state_tracks = enriched_tracks.loc[enriched_tracks['statename'].isin(states)]
    dates = state_tracks['track_date'].unique().tolist()
    date_cols = {date: date.strftime("%Y-%m-%d") for date in dates}
    date_columns: list[str] = [col for col in date_cols.values()]
    date_columns.sort()
    count_cols = date_columns + ['total_tracks']
