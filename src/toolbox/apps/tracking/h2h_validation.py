import io
import logging
import zipfile
from typing import Optional

from tqdm import tqdm
import geopandas as gpd
from fastapi.responses import StreamingResponse
from fastapi import APIRouter, UploadFile, File, Form, Query

from toolbox.utils import atimer, logger
from toolbox.campaign import CampaignDatasets
from toolbox.tracks_manager.tr import read_tracks
from toolbox.access.read_mgr import  read_dataset
from toolbox.access.export_mgr import add_to_archive
from toolbox.campaign.tracker import settlement_tracking
from toolbox.models import State, CampaignDay, Extensions


logger(log_name='Gridded Validation')
router = APIRouter()


async def prepare_datasets(
        settlement_file: UploadFile, tracks_file: UploadFile,
        extension: Extensions, day: int, mop_up: bool) -> CampaignDatasets:

    dip_data = await read_dataset(settlement_file)
    extension = extension.value if extension else None
    tracks_data: gpd.GeoDataFrame = await read_tracks(tracks_file, extension)

    campaign_day = CampaignDay(analysis_day=day, is_mop_up=mop_up)
    datasets = CampaignDatasets(dip_data, tracks_data, campaign_day)

    return datasets


@atimer(title="H2H Validation")
@router.post('/tracking/gridded', tags=['Tracking'])
async def h2h_settlement_tracking(
        tracks_path: UploadFile=File(...), dip_file: UploadFile = File(...),
        state_name: list[State] = Query(default=None), analysis_day: int=Form(...),
        is_mop_up: bool= Form(False), tracks_extension: Optional[Extensions]=Form(None),
        generate_report: bool = Form(False)) -> StreamingResponse:

    """
    Validate Campaign Settlement data and calculate the coverage level of enumeration at the settlement level
    using tracking data.

    Parameters
    -----------
    tracks_path: UploadFile
        Track(s) data path. It can be a single file or a folder containing tracks.<br>
    dip_file: UploadFile
        Path to Planned settlements DIP.<br>
    state_name: State
        State of Analysis.<br>
    analysis_day: int
        Provide the current Day of campaign.<br>
    is_mop_up: bool:
        Indicate whether the current campaign day is a mop-up day.<br>
    tracks_extension: Extensions
        Extensions of the file to read.<br>
    generate_report: bool
        Flag to indicate whether to generate daily reports.<br>

    Returns
    ---------
    FileResponse: Downloadable CSV of Settlement Visitation status and Coverage

    """

    logging.info("Validating Settlements by Grids")

    print('Reading Datasets...')
    datasets = await prepare_datasets(
        dip_file,
        tracks_path,
        tracks_extension,
        analysis_day,
        is_mop_up
    )

    print('Executing Settlement Coverage, Visitation and Time Spent Analysis...')

    validation_data = await settlement_tracking(datasets, state_name, generate_report)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, True) as zip_file:

        data_map = [
            (validation_data.settlements, dip_file.filename),
            (validation_data.tracks, f'tracks_day_{analysis_day}', f'tracks_day_{analysis_day}.gpkg'),
        ]

        for output in tqdm(data_map, total=len(data_map), desc='Compressing Outputs...'):
            add_to_archive(zip_file, *output)

        if validation_data.reports:
            # Add reports zip if available
            validation_data.reports.seek(0)
            zip_file.writestr(f'reports_{analysis_day}.zip', validation_data.reports.read())

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="h2h_outputs_day{analysis_day}.zip"'}
    )
