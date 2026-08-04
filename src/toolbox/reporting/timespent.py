from datetime import datetime, timedelta
from typing import Literal

import geopandas as gpd
import pandas as pd

from toolbox.reporting.viz import make_bar_chart, stylize
from toolbox.tools import find_column
from toolbox.configs import CONFIG


def define_duration(dataset: gpd.GeoDataFrame, team_col: str):
    team_duration: dict[str, float] = {}
    teams_data = dataset.groupby(by=team_col)
    for team_data in teams_data:
        team_code, team_df = team_data

        start_time, end_time = min(team_df['timestamp']), max(team_df['timestamp'])
        duration: timedelta = end_time - start_time
        duration_seconds = duration.total_seconds()
        team_duration[team_code] = duration_seconds

    return team_duration


def calculate_team_timestamp(total_hours: int, interval: int, duration_groups: dict, hour_def: int):
    team_timestamp = {}
    for i in range(1, total_hours + 1, interval):
        start_point = i
        end_point = start_point + interval
        if start_point == total_hours:
            break

        label = f"{start_point}-{end_point} HR"
        team_count = [
            code for code, duration in duration_groups.items()
            if (end_point * hour_def) > duration >= (start_point * hour_def)
        ].__len__()
        team_timestamp.update({label: team_count})

    return team_timestamp


def determine_max_hours(duration_map: dict[str, float], hour_def: int):
    return round(round(duration_map[max(duration_map, key=duration_map.get)]/hour_def))


def execute_timespent_analysis(
        tracks_data: gpd.GeoDataFrame, tracks_date: datetime, output_type: Literal['table', 'chart'], interval:int):
    days_tracks = tracks_data.loc[tracks_data['timestamp'].dt.date == tracks_date.date()]
    team_code = find_column(days_tracks, 'team code', 'raise')
    hr = CONFIG['HR']
    team_duration = define_duration(days_tracks, team_code)
    max_hours = determine_max_hours(team_duration, hr)

    duration_grouping: dict[str, int] = {}
    l30 = {"<30m": len([code for code, duration in team_duration.items() if duration < (hr / 2)])}
    l1hr = {"<1 HR": len([code for code, duration in team_duration.items() if hr > duration >= (hr / 2)])}
    duration_grouping.update(l30)
    duration_grouping.update(l1hr)
    team_duration_grouping = calculate_team_timestamp(max_hours, interval, team_duration, hr)
    duration_grouping.update(team_duration_grouping)

    df = pd.DataFrame.from_dict(duration_grouping, orient='index', columns=['duration']).reset_index(drop=False, names='timespent')
    if output_type == 'table':
        return df

    chart = make_bar_chart(
        df, 'timespent',
        y_fields='duration',
        color_scheme=None,
        text=True,
        axis_labels={'x': 'Time Spent', 'y': 'Number of Teams'},
        title = 'Time Spent Analysis'
    )
    chart = stylize(chart, True, x_label='Time Spent', y_label='Number of Teams')
    # chart.write_image(r'C:\WORKSPACE\MAP_SUPPORT\CAMPAIGN COVERAGE MAPS\KB_2025\test.png')
    return chart


if __name__ == '__main__':
    tracks = gpd.read_file(r"C:\WORKSPACE\IBV\November 2025\tracks_data.sqlite")
    date = datetime(year=2025, month=12, day=3)
    execute_timespent_analysis(tracks, date, 'chart', 1)