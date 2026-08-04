import logging
import zipfile
import io

from fastapi import APIRouter, UploadFile, Form
from fastapi.responses import StreamingResponse

from toolbox.utils import logger
from toolbox.access import read_mgr
from toolbox.access.export_mgr import add_to_archive
from toolbox.target_area.generate import generate_settlement_target_area, TADatasets

router = APIRouter()
logger = logger(log_name='Generate Target Area')


@router.post('/ta/generate_ta', tags=['Campaign'])
async def generate_target_area(mlos_file: UploadFile, planned_list: UploadFile = Form(None)) -> StreamingResponse:
    """
    Generate Gridded Target Area and Voronoi from MLOS settlements and predefined settlement types.

    Parameters
    ----------
    mlos_file: UploadFile
        Master List of Settlement File.

    planned_list: UploadFile
        Subset of Settlement List which Activity tracking. Optional can be Blank.

    Returns
    -------
        FileResponse: Downloadable file containing the generated Gridded Target Area.
    """

    logging.info(f"Generating Settlements Voronoi and Gridded Target Area ")

    mlos_data = await read_mgr.read_dataset(mlos_file, is_spatial=True)
    planned_data = await read_mgr.read_dataset(planned_list, is_spatial=True) if planned_list else None

    target_area_datasets: TADatasets = generate_settlement_target_area(mlos_data, planned_data)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'a', zipfile.ZIP_DEFLATED, True) as zipper:
        add_to_archive(zipper, target_area_datasets.voronoi, "voronoi", "voronoi")
        add_to_archive(zipper, target_area_datasets.gridded_ta, "gridded_ta", "gridded_ta")

        if planned_list:
           add_to_archive(zipper, target_area_datasets.voronoi_subset, "voronoi", "subset_voronoi")
           add_to_archive(zipper, target_area_datasets.gridded_ta_subset, "gridded_ta", "gridded_ta_subset")

    logging.info('All Results Added to Zip Archive')
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="target_area_datasets.zip"'}
    )
