import logging
from typing import Optional, Any

import geopandas as gpd
from fastapi import APIRouter, UploadFile, Form
from starlette.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from toolbox.utils import atimer, logger
from toolbox.utils.offload import run_heavy
from toolbox.tools import generate_output_name, read_compiled_data
from toolbox.models import TriangulationMethod, State
from toolbox.triangulate import triangulating_reached_settlements
from toolbox.access.read_mgr import read_dataset
from toolbox.tracks_manager.tr import read_tracks
from toolbox.mlos import detect_unique_admin_field, construct_new_unique, get_admin_col
from toolbox.dataops import reach as reach_checks
from toolbox.job_tracker.context import report_stage
from toolbox.utils.tempfiles import new_result_file, remove_file, delete_after_response

router = APIRouter()
logger(log_name='REACH Analysis')


@atimer
@router.post('/validation', name='REACH Analysis', tags=['Tracking'])
async def reach_analysis(
        planned_settlements: UploadFile, data_sources: UploadFile,
        tracks: Optional[UploadFile] = Form(None), method: TriangulationMethod = TriangulationMethod.BOTH):
    """
    Conduct Reach analysis using multiple datasets against the settlement list for a state.

    Parameters
    ----------
    planned_settlements: UploadFile
        MLoS or Planned Settlement list.<br>
    data_sources: list[UploadFile]
        external data sources to be used for reach analysis<br>
    # source_names
    #     names of the external data sources used in the order of their inclusion.<br>

    method: TriangulationMethod
    tracks: UploadFile
        GTS tracks<br>
        

    WARNING⚠️: Be sure to separate the names by a comma and in the same order that the data sources are inputted.
               Future versions may support other delimiters.

    Returns
    -------
        FileResponse
    """

    logging.info('Conducting REACH Analysis')

    print('Reading Datasets...')
    report_stage('Reading settlements')
    mlos_gdf: gpd.GeoDataFrame = await read_dataset(planned_settlements, False)
    logging.info('Read %d planned settlements', len(mlos_gdf))
    state_col = get_admin_col(mlos_gdf, 'state')
    states = reach_checks.resolve_states(mlos_gdf[state_col])
    uniquecode = detect_unique_admin_field(mlos_gdf)
    if uniquecode is None:
        uniquecode = 'uniquecode'
        mlos_gdf = construct_new_unique(mlos_gdf, uniquecode)

    report_stage('Reading data sources')
    datasets: dict[str, Any] = await read_compiled_data(data_sources)
    if tracks is not None:
        datasets['GTS'] = await read_tracks(tracks, None)
    logging.info('Read %d data source(s): %s', len(datasets), ', '.join(map(str, datasets)))

    methods = [method] if method != TriangulationMethod.BOTH else [TriangulationMethod.COORDS, TriangulationMethod.SETTLEMENT]
    # Stops early, with a message that says what to fix, when an input would crash the analysis
    # or make the result meaningless; `report` also collects warnings for the X-Data-Warning header.
    settlement_count = len(mlos_gdf)
    report_stage('Validating inputs')
    logging.info('Checking the inputs')
    report = reach_checks.validate_input(
        mlos_gdf, datasets, unique_code=uniquecode, state_names=[s.value for s in states],
        use_coords=TriangulationMethod.COORDS in methods, use_settlement=TriangulationMethod.SETTLEMENT in methods)

    print('\nStarting REACH Analysis...')
    report_stage('Matching settlements')
    logging.info('Matching settlements to the data sources (%s)', ', '.join(str(getattr(m, 'value', m)) for m in methods))
    # Heavy synchronous work: run it off the event loop so the API keeps answering other requests.
    triangulated_list = await run_heavy(
        triangulating_reached_settlements, mlos_gdf, datasets, methods, uniquecode, states)

    print('Cleaning Up Results...')
    logging.info('Cleaning up results')
    dropping_cols = ['geometry']
    triangulated_list = triangulated_list.drop(columns=dropping_cols, errors='ignore')
    triangulated_list.sort_values(by=[uniquecode, 'reach'], ascending=True, inplace=True)
    reach_checks.check_output(report, triangulated_list, settlement_count, list(datasets))

    print('Saving and Exporting to CSV')
    report_stage('Writing results')
    logging.info('Saving and Exporting to CSV (%d rows)', len(triangulated_list))
    # The file is deleted once the response has been sent (see toolbox.utils.tempfiles).
    result_path = new_result_file('.csv')
    try:
        await run_in_threadpool(triangulated_list.to_csv, result_path, index=False)
    except Exception:
        remove_file(result_path)
        raise

    save_name = generate_output_name(planned_settlements.filename, 'csv', 'REACH')
    return FileResponse(
        result_path,
        media_type="text/csv",
        filename=save_name,
        headers=report.headers(),
        background=delete_after_response(result_path)
    )
