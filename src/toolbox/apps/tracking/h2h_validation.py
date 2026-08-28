import io
import logging
import zipfile
from typing import Optional

from tqdm import tqdm
import geopandas as gpd
from fastapi.responses import Response, StreamingResponse
from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException

from toolbox.mlos import get_admin_col
from toolbox.utils import atimer, logger
from toolbox.campaign import CampaignDatasets
from toolbox.tracks_manager.tr import read_tracks
from toolbox.access.read_mgr import  read_dataset
from toolbox.access.export_mgr import add_to_archive
from toolbox.campaign.tracker import settlement_tracking
from toolbox.models import State, CampaignDay, Extensions
from toolbox.apps.tracking import h2h_cache


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


@router.post('/tracking/gridded', tags=['Tracking'])
async def h2h_settlement_tracking(
        tracks_path: UploadFile=File(...), dip_file: UploadFile = File(...), analysis_day: int=Form(...),
        is_mop_up: bool= Form(False), tracks_extension: Optional[Extensions]=Form(None), generate_report: bool = Form(False)) -> Response:

    """
    Validate Campaign Settlement data and calculate the coverage level of enumeration at the settlement level
    using tracking data.

    Parameters
    -----------
    tracks_path: UploadFile
        Track(s) data path. It can be a single file or a folder containing tracks.<br>
    dip_file: UploadFile
        Path to Planned settlements DIP.<br>
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
    Response: Downloadable CSV of Settlement Visitation status and Coverage.

        Deliberately does NOT include the tracks GeoPackage or the optional
        reports zip — those are the slow parts (serializing tracks to a
        GeoPackage in particular), and settlement_tracking() below already
        has the settlements DataFrame fully computed before that
        serialization would even start. This response carries an
        `X-Job-Id` header instead; fetch the full ZIP afterward, only if/
        when it's actually wanted, via GET /tracking/gridded/archive/{job_id}
        (see h2h_settlement_tracking_archive below and h2h_cache.py). That id
        is valid for a limited time and is consumed by the first successful
        archive download — a second archive request for the same id 404s.

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

    state_col = get_admin_col(datasets.settlements, 'state', 'raise')
    states = datasets.settlements[state_col].str.title().unique().tolist()
    state_names = [State[state] for state in states]

    print('Executing Settlement Coverage, Visitation and Time Spent Analysis...')
    validation_data = await settlement_tracking(datasets, state_names, generate_report)

    # Both the settlements DataFrame and the tracks GeoDataFrame are fully
    # computed at this point (settlement_tracking derives them together from
    # one assess_grid_visitation() call) — what's still ahead is purely
    # serialization. Stash everything the archive endpoint needs so it can
    # build the ZIP later from this same data, and hand the settlements CSV
    # back right now instead of blocking on that serialization.
    job_id = h2h_cache.store_result(
        settlements=validation_data.settlements,
        tracks=validation_data.tracks,
        reports=validation_data.reports,
        analysis_day=analysis_day,
        dip_filename=dip_file.filename,
    )

    csv_buffer = io.StringIO()
    validation_data.settlements.to_csv(csv_buffer, index=False, encoding='utf-8')

    return Response(
        content=csv_buffer.getvalue(),
        media_type='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename="{dip_file.filename.split(".")[0]}.csv"',
            'X-Job-Id': job_id,
        },
    )


@router.get('/tracking/gridded/archive/{job_id}', tags=['Tracking'])
async def h2h_settlement_tracking_archive(job_id: str) -> StreamingResponse:
    """
    Builds and returns the full h2h_outputs_day{N}.zip (settlements CSV +
    tracks GeoPackage + optional reports) for a run POST /tracking/gridded
    already computed — see that route's docstring for why this is a separate,
    on-demand request instead of part of the original response.

    Reuses the cached DataFrames from that run rather than recomputing
    anything — no re-upload, no re-running settlement_tracking(). The tracks
    GeoPackage's serialization (the slow step this split exists to move out
    of the fast path) happens here, the first and only time this is called
    for a given job id — see h2h_cache.pop_result.

    Raises
    -------
    404: job_id is unknown, already downloaded once, or has expired
        (results are kept for h2h_cache.TTL_SECONDS). Re-run the analysis to
        get a fresh id.
    """

    cached = h2h_cache.pop_result(job_id)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=(
                'This result is no longer available to download — it may have already been '
                'downloaded once, or the run is more than 30 minutes old. Re-run the analysis '
                'to get a fresh download.'
            ),
        )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, True) as zip_file:

        data_map = [
            (cached.settlements, f"{cached.dip_filename.split('.')[0]}.csv"),
            (cached.tracks, f'tracks_day_{cached.analysis_day}', f'tracks_day_{cached.analysis_day}.gpkg'),
        ]

        for output in tqdm(data_map, total=len(data_map), desc='Compressing Outputs...'):
            add_to_archive(zip_file, *output)

        if cached.reports:
            # Add reports zip if available
            cached.reports.seek(0)
            zip_file.writestr(f'reports_{cached.analysis_day}.zip', cached.reports.read())

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="h2h_outputs_day{cached.analysis_day}.zip"'}
    )
