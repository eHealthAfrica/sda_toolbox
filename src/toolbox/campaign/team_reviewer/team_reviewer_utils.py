from datetime import datetime, timedelta
from typing import Literal
import re

import pandas as pd
import geopandas as gpd
from geopy.distance import geodesic

from toolbox.tools import is_empty


def create_unique_field(tracks_data: gpd.GeoDataFrame) -> pd.DataFrame:
    tracks_data[f'unique_code'] = tracks_data.apply(
        lambda row: f"{row['statename']}_{row['lganame']}_{row['wardname']}_{row['Team Code']}*{row['IMEI']}", axis=1)
    return tracks_data


def aggregate_tracks(tracks_data: gpd.GeoDataFrame, date_columns: dict[datetime, str]) -> pd.DataFrame:
    tracks_summary = tracks_data.groupby(by=[f'unique_code', 'track_date']).size().unstack().fillna(0)
    tracks_summary.rename(columns=date_columns, inplace=True)
    tracks_summary.reset_index(drop=False, names=f'unique_code', inplace=True)
    tracks_summary['total_tracks'] = tracks_summary.sum(numeric_only=True, axis=1)
    return tracks_summary


def retrieve_admin_values(tracks_data: pd.DataFrame) -> pd.DataFrame:
    tracks_data[f'unique_code'] = tracks_data[f'unique_code'].str.split('_')
    tracks_data.insert(0, 'statename', tracks_data[f'unique_code'].str[0])
    tracks_data.insert(1, 'lganame', tracks_data[f'unique_code'].str[1])
    tracks_data.insert(2, 'wardname', tracks_data[f'unique_code'].str[2])
    tracks_data.insert(3, 'code', tracks_data[f'unique_code'].str[3])
    tracks_data.drop(columns='unique_code', inplace=True)
    return tracks_data


def create_summary(summary_data: pd.DataFrame, summary_lv: Literal['state', 'lga', 'ward'], field: str, count_cols: list[str]) -> pd.DataFrame:
    cols_map = {
        'state': ['statename'],
        'lga': ['statename', 'lganame'],
        'ward': ['statename', 'lganame', 'wardname'],
    }

    agg_dict = {col: 'sum' for col in count_cols}
    agg_dict[field] = 'nunique'
    if 'work_days' in summary_data.columns:
        summary_data['max_days'] = summary_data['work_days']
        summary_data['min_days'] = summary_data['work_days']
        agg_dict['max_days'] = 'max'
        agg_dict['min_days'] = 'min'

    group_cols = cols_map.get(summary_lv)
    summary = summary_data.groupby(by=group_cols).agg(agg_dict).reset_index()
    summary.rename(columns={field: 'teams'}, inplace=True)
    summary_columns: list[str] = group_cols + ['teams'] + count_cols + ['max_days', 'min_days']
    summary = summary.loc[:, summary_columns]
    return summary


def flag_tracks_duration_ratio(track_count: int, duration: float):
    tracks_buffer = track_count + 4 # adding a buffer to tracks

    if duration==0:
        return "Switched Off"
    ratio =  tracks_buffer/ duration
    if ratio < 0.3:
        return "Track Inconsistency"

    return None


def work_indicators_assessment(travel_distance: float, time_spent: float) -> str | None:
    if is_empty(travel_distance):
        return "Clustered Tracks"

    if is_empty(time_spent):
        return "No Tracking"

    # using a minimum threshold of 3 daily work hours
    if time_spent < 180:
        return "Low Work hours"

    return None


def covered_distance(group_tracks: gpd.GeoDataFrame) -> float:
    # Ensure tracks are sorted chronologically if you have a timestamp column
    # group_tracks = group_tracks.sort_values('timestamp')
    group_tracks.sort_values(by=['timestamp'], inplace=True)
    total_distance = 0.0

    # Extract coordinates as (lat, lon) for geopy
    # Assumes your CRS is geographic (e.g., EPSG:4326 / WGS84)
    coords = [(point.y, point.x) for point in group_tracks.geometry if isinstance(point, Point)]

    # Loop through pairs of points and accumulate the geodesic distance
    for i in range(len(coords) - 1):
        total_distance += geodesic(coords[i], coords[i+1]).meters

    return total_distance


def coverage_area(group_tracks: gpd.GeoDataFrame) -> float:
    """Calculates the area of the convex hull enclosing all tracks in square meters."""
    # 1. Project to a metric CRS (e.g., World Mercator EPSG:3395 or local UTM)
    gdf_metric = group_tracks.to_crs(32632)

    # 2. Combine all points into a single geometry collection and get the convex hull
    unified_geom = gdf_metric.geometry.union_all(method='coverage')
    convex_hull = unified_geom.convex_hull

    # 3. Return area in square meters
    return convex_hull.area


def daily_team_analysis(location: int, grouper: tuple[str, datetime], group_tracks: gpd.GeoDataFrame):
    team_code, analysis_date = grouper
    track_count = len(group_tracks)
    start_time, end_time = min(group_tracks['timestamp']), max(group_tracks['timestamp'])
    duration: timedelta = end_time - start_time
    duration_mins: float = duration.total_seconds() / 60
    distance = covered_distance(group_tracks)
    device_flag: str | None = flag_tracks_duration_ratio(track_count, duration_mins)
    work_rate_flag = work_indicators_assessment(distance, duration_mins)
    return {
        location: [team_code, analysis_date, track_count, start_time, end_time, duration_mins, distance, device_flag, work_rate_flag]
    }


def missing_workday_analysis(workdays: int, activity_days: int, start_date: datetime):
    expected_days: timedelta = (datetime.now().date() - start_date)
    actual_days = min(expected_days.days, activity_days)
    diff = actual_days - workdays
    if diff <= 0:
        return None

    return f"Missed {diff} days"


def separate_code_imei(tracks_data: pd.DataFrame) -> pd.DataFrame:
    tracks_data['team_imei'] = tracks_data['code'].str.split('*')
    tracks_data.insert(3, 'team_code', tracks_data[f'team_imei'].str[0])
    tracks_data.insert(4, 'imei', tracks_data[f'team_imei'].str[1])
    tracks_data.drop(columns=['team_imei', 'code'], inplace=True)
    return tracks_data


def team_code_review(row):
    team_code: str = row['team_code']
    team_code = team_code.replace(' ', '').replace('-', '').replace("//", '/')
    team_code_pattern = r'^[A-Z]{2,4}/[A-Z0-9.-]{2,5}/[A-Z0-9.-]{2,5}/(?:[A-Z0-9.-]+/)*\d{3}$'
    match = re.match(team_code_pattern, team_code, re.IGNORECASE)
    if match:
        return None

    imei: str = str(row['imei'])
    if not is_empty(imei):
        return "Invalid Team Code"

    if imei.startswith('vbu'):
        return None

    return "Invalid Team Code"