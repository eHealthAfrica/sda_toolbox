import io
import zipfile
import logging
from typing import Optional

import pandas as pd
import geopandas as gpd
from fastapi import APIRouter, UploadFile
from fastapi.responses import StreamingResponse

from toolbox.configs import CONFIG
from toolbox.access import read_mgr
from toolbox.spatial_mgr import SpatialOps
from toolbox.tracks_manager.tr import read_tracks
from toolbox.utils import atimer, logger
from toolbox.models import State, CampaignDay, Extensions
from toolbox.access.export_mgr import create_spatial_sqlite
from toolbox.tracks_manager.preprocess import preprocess_tracks
from toolbox.mlos import detect_unique_admin_field, construct_new_unique
from toolbox.campaign.campaign_tools import (
    group_data,
    detect_day_column,
    update_day_visitation,
    set_cumulative_visitation,
    validate_with_buffered_tracks,
)

logger(log_name='Buffer Validation')
router = APIRouter()


def preprocess(track_data: gpd.GeoDataFrame, aoi: State) -> tuple[gpd.GeoDataFrame, ...]:
    logging.info("Executing Preprocessing Operation...")
    clipped_tracks = preprocess_tracks(track_data, aoi)
    distance_meters = CONFIG.get('BUFFER_DISTANCE_METERS')
    buffered_tracks = SpatialOps.create_buffer(clipped_tracks, distance_meters)
    return buffered_tracks, clipped_tracks


def visitation_analysis(dip_data: pd.DataFrame, campaign_day: CampaignDay):
    cumulative_coverage = set_cumulative_visitation(dip_data, campaign_day.analysis_day)

    day_col = detect_day_column(campaign_day.analysis_day, cumulative_coverage)
    cumulative_coverage[day_col] = cumulative_coverage.apply(
        update_day_visitation, args=(campaign_day.analysis_day, day_col), axis=1)

    cum_column = f'day_{campaign_day.analysis_day}_cumm'
    if campaign_day.is_mop_up:
        cumulative_coverage.loc[cumulative_coverage[cum_column]=='Not Yet Visited', [cum_column]] = 'Not Visited'

    summary = cumulative_coverage.groupby(cum_column).size()
    print(summary)

    return cumulative_coverage


@atimer(title='Compromised Settlement Tracking')
@router.post('/tracking/buffer', tags=['Tracking'])
async def buffer_validation(
        settlements_file: UploadFile, track_data: UploadFile, analysis_day: int,
       state: State,  is_mop_up: bool=False, extension: Optional[Extensions]=None) -> StreamingResponse:
    """
    Track settlement visitation using the hit-and-run/ buffer method

    Parameters
    ----------
    **settlements_file: str**
        Path to Campaign settlement DIP data.<br>
    **track_data: str**
        File or folder of tracks data.<br>
    **analysis_day: int**
        Day of campaign for visitation and cumulative analysis.<br>
    **is_mop_up: bool**
        Day of campaign for visitation and cumulative analysis.<br>
    **state: State**
        Campaign State.<br>
    **extension: str**
        extension of the track file(s). Only required if a folder of tracks was used rather than a single file.<br>

    Returns
    -------
        FileResponse: Validated Settlements data

    """

    print('Reading Files...')
    settlements_data = await read_mgr.read_dataset(settlements_file, True)
    extension = extension.value if extension else None
    track_data = await read_tracks(track_data, extension)

    unique_admin_code = detect_unique_admin_field(settlements_data)
    if not unique_admin_code:
        print("Not Found")
        unique_admin_code = 'unique_code'
        settlements_data = construct_new_unique(settlements_data, unique_admin_code)

    print('Pre-Processing Tracks and Validating Settlements...')
    tracks_buffer, track_data = preprocess(track_data, state)

    print('Executing Validating Operation...')
    dip_merged = settlements_data.sjoin(tracks_buffer, how='left', predicate='intersects')
    dip_merged.sort_values(by=[unique_admin_code, 'index_right'], inplace=True)

    print('Updating DIP...')
    data_groups = group_data(dip_merged, unique_admin_code)
    processed_settlements = validate_with_buffered_tracks(data_groups, unique_admin_code)
    campaign_day = CampaignDay(analysis_day=analysis_day, is_mop_up=is_mop_up)
    cumulative_coverage = visitation_analysis(processed_settlements, campaign_day)
    cols_to_drop: list = CONFIG.get('DROPPING').get('RES')
    cumulative_coverage.drop(columns=cols_to_drop, inplace=True, errors='ignore')

    print(f'\n\nValidation Complete for Day {campaign_day.analysis_day}')
    logging.info(f'Validation of Planned Settlements for Day {campaign_day.analysis_day} Complete')

    print('\nCompressing Outputs...')
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, False) as zip_file:
        # Add updated_dip as CSV
        csv_buffer = io.StringIO()
        cumulative_coverage.to_csv(csv_buffer, index=False, encoding='utf-8')
        zip_file.writestr(settlements_file.filename, csv_buffer.getvalue())

        # Add tracks data as SQLite
        tracks_bytes = create_spatial_sqlite(track_data, f'tracks_day_{analysis_day}')
        zip_file.writestr('tracks_data.gpkg', tracks_bytes)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="hitnrun_output_day{analysis_day}.zip"'}
    )


if __name__ == '__main__':
    root_path = "C:\\WORKSPACE\\RES\\RES_11"
    settlements = f"{root_path}\\res_11_dip.csv"
    tracks = f'{root_path}\\Tracks'
    day = int(input("Campaign Day: "))
    buffer_validation(settlements, tracks, day, State.Kebbi, extension='csv', mop_up=False)