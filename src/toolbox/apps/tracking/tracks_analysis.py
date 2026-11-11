import logging

from fastapi import APIRouter, UploadFile, File
from starlette.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
import pandas as pd

from toolbox.dataops import gts as gts_checks
from toolbox.job_tracker.context import report_stage
from toolbox.utils.tempfiles import new_result_file, remove_file, delete_after_response
from toolbox.tracks_manager.tr import read_tracks, read_dataset
from toolbox.campaign.device_tracking import gts_device_team_analysis

router = APIRouter()


@router.post("/tracking/devices", tags=["Tracking"])
async def gts_device_tracking(
        tracks_file: UploadFile, activity_code: str, vaccine_buddy_mapping: UploadFile=File(None)) -> FileResponse:

    logging.info('Starting team and device tracking for activity %s', activity_code)
    report_stage('Reading tracks')
    tracks = await read_tracks(tracks_file)
    logging.info('Read %d track rows', len(tracks))
    vb_mapping = await read_dataset(vaccine_buddy_mapping) if vaccine_buddy_mapping else pd.DataFrame()
    if vaccine_buddy_mapping:
        logging.info('Read %d vaccine buddy mapping rows', len(vb_mapping))
    # Stop early, with a message that says what to fix, if the tracks cannot be analysed;
    # `report` also collects warnings about the result for the X-Data-Warning header.
    report_stage('Validating tracks')
    logging.info('Checking the tracks file')
    report = gts_checks.validate_input(tracks, activity_code, vb_mapping)
    report_stage('Analysing teams and devices')
    logging.info('Analysing teams and devices')
    analysis_results = await gts_device_team_analysis(tracks, activity_code, vb_mapping)
    gts_checks.check_output(report, analysis_results)

    report_stage('Writing results')
    logging.info('Writing %d result rows to CSV', len(analysis_results))
    # The file is deleted once the response has been sent (see toolbox.utils.tempfiles).
    result_path = new_result_file('.csv')
    try:
        await run_in_threadpool(analysis_results.to_csv, result_path, index=False)
    except Exception:
        remove_file(result_path)
        raise

    return FileResponse(
        result_path,
        filename=f"team_analysis/{activity_code}.csv",
        media_type='text/csv',
        headers=report.headers(),
        background=delete_after_response(result_path)
    )