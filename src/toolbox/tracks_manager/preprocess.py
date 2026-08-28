import warnings
from functools import wraps
from datetime import datetime, time
from collections.abc import Callable


import pandas as pd
import geopandas as gpd

from toolbox.models import State
from toolbox.configs import CONFIG
from toolbox.tools import find_column
from toolbox.access import ReadDBData
from toolbox.spatial_mgr import SpatialOps
from toolbox.exceptions import NoRecordsFound

warnings.filterwarnings(action='ignore')


def create_timestamp(gps_time: str):
    try:
        gps_time = datetime.strptime(gps_time, "%m/%d/%Y %H:%M:%S")
    except ValueError:
        return None

    return gps_time


def filter_valid_tracks(default_filter=True):
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            should_filter = kwargs.pop('apply_filter', default_filter)
            try:
                tracks_df: gpd.GeoDataFrame = await func(*args, **kwargs)
                pattern = rf"{CONFIG.get('REGEX').get('COORD_PATTERN')}"
                latitude, longitude, speed = [
                    find_column(tracks_df, col_name=col)
                    for col in ['lat', 'lon', 'speed mps']
                ]

                mask = (
                    tracks_df[latitude].astype(str).str.match(pattern) &
                    tracks_df[longitude].astype(str).str.match(pattern) &
                    tracks_df[speed].astype(str).str.match(pattern)
                )

                matched_tracks = tracks_df[mask].copy()
                matched_tracks[latitude] = matched_tracks[latitude].astype('float32')
                matched_tracks[longitude] = matched_tracks[longitude].astype('float32')
                matched_tracks[speed] = matched_tracks[speed].astype('float32')

                if should_filter:
                    stamp_col = find_column(matched_tracks, 'gps timestamp')
                    time_format = "%m/%d/%Y %H:%M:%S"
                    matched_tracks.loc[:, ['timestamp']] = pd.to_datetime(matched_tracks[stamp_col], format=time_format)
                    valid_mask = (
                        (matched_tracks[speed]<1) &
                        (matched_tracks['timestamp'].dt.hour>=7) &
                        (matched_tracks['timestamp'].dt.hour<=16)
                    )
                    valid_tracks = matched_tracks[valid_mask].copy()

                    return valid_tracks

                return matched_tracks

            except Exception:
                raise

        return wrapper
    return decorator


def preprocess_tracks(tracks: gpd.GeoDataFrame, aoi: list[State] | None = None) -> gpd.GeoDataFrame:
    """
    Filter Tracks for to within a target state boundary

    Parameters
    ------------
    tracks: GeoDataFrame of tracks
    aoi: AOI to clip the tracks

    Returns
    -------------
        GeoDataFrame | tuple[GeoDataFrame, GeoDataFrame]

    """

    table_name = CONFIG.get('DATASETS').get('state_boundary')
    states = [state.value for state in aoi] if aoi else None
    query_param = None if states is None else {"statename": states}
    boundary: gpd.GeoDataFrame = ReadDBData(table_name, True).read_data(query_param)
    clipped_tracks = SpatialOps.clip_dataset(tracks, boundary)
    if clipped_tracks.empty:
        raise NoRecordsFound('No Records', f'No Tracks within {", ".join(states)}')

    return clipped_tracks
