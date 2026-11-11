import logging
import zipfile
import io

from fastapi import APIRouter, UploadFile, Form
from fastapi.responses import StreamingResponse

from toolbox.exceptions import DataError
from toolbox.utils import logger
from toolbox.access import read_mgr
from toolbox.access.export_mgr import add_to_archive
from toolbox.utils.offload import run_heavy
from toolbox.target_area.v1.generate import generate_settlement_target_area, TADatasets, Identifier
from toolbox.target_area.run_summary import SUMMARY_HEADER, summary_header_value
from toolbox.target_area.buffer_target_area import generate_buffer_target_area

router = APIRouter()
logger = logger(log_name='Generate Target Area')



@router.post('/ta/generate_ta', tags=['Campaign'])
async def generate_target_area(mlos_file: UploadFile, identifier: Identifier = Form(None), planned_list: UploadFile = Form(None)) -> StreamingResponse:
    """
    Generate Gridded Target Area and Voronoi from MLOS settlements and predefined settlement types.

    Parameters
    ----------
    mlos_file: UploadFile
        Master List of Settlement File.

    planned_list: UploadFile
        Subset of Settlement List which Activity tracking. Optional can be Blank.

    identifier: Identifier

    Returns
    -------
        FileResponse: Downloadable file containing the generated Gridded Target Area.
    """

    logging.info(f"Generating Settlements Voronoi and Gridded Target Area ")


    mlos_data = await read_mgr.read_dataset(mlos_file, is_spatial=True)
    planned_data = await read_mgr.read_dataset(planned_list, is_spatial=True) if planned_list else None

    target_area_datasets: TADatasets = await run_heavy(generate_settlement_target_area, mlos_data, planned_data, identifier)

    def build_archive() -> io.BytesIO:
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'a', zipfile.ZIP_DEFLATED, True) as zipper:
            add_to_archive(zipper, target_area_datasets.voronoi, "voronoi", "voronoi")
            add_to_archive(zipper, target_area_datasets.gridded_ta, "gridded_ta", "gridded_ta")

            if planned_list:
                add_to_archive(zipper, target_area_datasets.voronoi_subset, "voronoi", "subset_voronoi")
                add_to_archive(zipper, target_area_datasets.gridded_ta_subset, "gridded_ta", "gridded_ta_subset")

        logging.info('All Results Added to Zip Archive')
        archive.seek(0)
        return archive

    buffer = await run_heavy(build_archive)

    # Which states ran and which were skipped (and why), for the Target Area page.
    summary = summary_header_value(target_area_datasets.states_run, target_area_datasets.skipped_states)

    return StreamingResponse(
        buffer,
        media_type="application/x-zip-compressed",
        headers={
            "Content-Disposition": f'attachment; filename="target_area_datasets.zip"',
            SUMMARY_HEADER: summary,
        }
    )



@router.post('/ta/generate_ta/buffer', tags=['Campaign'])
async def generate_buffer_based_ta(planned_settlement_list: UploadFile, buffer_distance: int=200):
    """
    Using the Buffer Strategy to generate Target Area datasets for settlement tracking.
    This strategy is primarily used for RES/RIC  and Nomadic vaccination activities.

    Parameters
    ----------
    planned_settlement_list: UploadFile
        Planned Settlement List

    buffer_distance: int
        The Settlement Buffer Distance for the voronoi

    Returns
    -------

    Raises
        DataError: if buffer distance is less than 100 or greater than 400

    """

    if buffer_distance < 100 or buffer_distance > 400:
        raise DataError('Invalid Distance', "Distance must be between 100 and 400")

    datasets = await read_mgr.read_dataset(planned_settlement_list, is_spatial=True)

    buffer_voronoi, buffer_grids = await generate_buffer_target_area(datasets, buffer_distance)

    def build_archive() -> io.BytesIO:
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'a', zipfile.ZIP_DEFLATED, True) as zipper:
            add_to_archive(zipper, buffer_voronoi, "voronoi", "voronoi")
            add_to_archive(zipper, buffer_grids, "gridded_ta", "gridded_ta")

        logging.info('All Results Added to Zip Archive')
        archive.seek(0)
        return archive

    buffer = await run_heavy(build_archive)

    return StreamingResponse(
        buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="buffer_target_area_datasets.zip"'}
    )