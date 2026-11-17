import concurrent.futures as cf
import logging

import pandas as pd
from tqdm import tqdm
import geopandas as gpd

from toolbox.utils import atimer
from toolbox.utils.offload import run_heavy
from toolbox.campaign.team_reviewer import (
    tracks_cleanup,
    match_vb_team_code,
    build_tracks_admin_code,
    get_admin_names,
    create_unique_field,
    daily_team_analysis,
    retrieve_admin_values,
    separate_code_imei,
    team_code_review,
)

def prepare_tracks_data(tracks: gpd.GeoDataFrame, vb_map: pd.DataFrame) -> gpd.GeoDataFrame:
    logging.info('Preparing tracks data for Analysis')
    tracks['track_date'] = tracks['timestamp'].dt.date
    valid_tracks = tracks_cleanup(tracks)
    if not vb_map.empty:
        valid_tracks = match_vb_team_code(vb_map, valid_tracks)

    valid_tracks['admincode'] = valid_tracks['Team Code'].apply(build_tracks_admin_code)
    enriched_tracks = get_admin_names(valid_tracks)
    enriched_tracks: gpd.GeoDataFrame = create_unique_field(enriched_tracks)
    return enriched_tracks


def process_tracks(field_tracks: gpd.GeoDataFrame):
    logging.info('Executing Device/team Analysis')
    data_groups = [group for group in field_tracks.groupby(by=['unique_code', 'track_date'])]
    data_groups = [(idx, grouper, df) for idx, (grouper, df) in enumerate(data_groups)]

    processed_groups = {}
    with cf.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(daily_team_analysis, *data_group) for data_group in data_groups]

        for future in tqdm(futures, desc="Processed", unit='groups ', total=len(data_groups)):
            processed_group = future.result()
            processed_groups.update(processed_group)


    processed_data = pd.DataFrame.from_dict(
        processed_groups, orient='index',
        columns=['unique_code', 'analysis_date', 'track_count', 'start_time', 'end_time', 'duration_mins',
                 'distance_meters', 'coverage_area_sqm', 'device_flag', 'work_rate_flag']
    )

    return processed_data

def parse_attributes(summary: pd.DataFrame) -> pd.DataFrame:
    logging.info('Parsing Device/team Attributes')
    team_daily_summary = summary.copy()
    team_daily_summary = retrieve_admin_values(team_daily_summary)
    team_daily_summary = separate_code_imei(team_daily_summary)
    return team_daily_summary


def _analyse_device_teams(tracks_data: gpd.GeoDataFrame, campaign_code: str, vb_data: pd.DataFrame) -> pd.DataFrame:
    active_tracks = prepare_tracks_data(tracks_data, vb_data)
    team_analysis = process_tracks(active_tracks)
    daily_summary = parse_attributes(team_analysis)
    daily_summary['team_code_flag'] = daily_summary.apply(team_code_review, args=(campaign_code,), axis=1)

    return daily_summary


@atimer(display=True, title='GTS Device Team Review')
async def gts_device_team_analysis(tracks_data: gpd.GeoDataFrame, campaign_code: str, vb_data: pd.DataFrame) -> pd.DataFrame:
    # All the work is pandas/geopandas on the whole upload. Run on the event loop it would freeze every
    # other request (including /health) until it finished, so it goes to a worker thread (hardening H7).
    return await run_heavy(_analyse_device_teams, tracks_data, campaign_code, vb_data)


if __name__ == '__main__':
    import asyncio
    from toolbox.tracks_manager.tr import read_tracks

    tracks = asyncio.run(read_tracks(r"C:\Users\enyinnaya.nwaiwu\Downloads\export_1253_2026-11-08_14-39-37_combined.gpkg"))
    res = asyncio.run(gts_device_team_analysis(tracks, 'NIPDs', pd.DataFrame()))
    res.to_csv(r'C:\Workspace\NEOC\NIPDs\NOV ROUND\Analysis\device_analysis_d2csv')
