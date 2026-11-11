from io import BytesIO
import tempfile
import zipfile
import os

from fastapi.responses import StreamingResponse
from fastapi import APIRouter, UploadFile, File, Form
from starlette.concurrency import run_in_threadpool
from tqdm import tqdm
import pandas as pd

from toolbox.mlos.planfeld import generate_team_dips, validate_daily_implementation_plan, merge_maps_to_dips
from toolbox.tools import save_uploaded_file, extract_and_find_file, is_empty, generate_output_name
from toolbox.access.export_mgr import add_to_archive
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import InvalidInputError
from toolbox.models import State
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response, new_result_file, remove_file

router = APIRouter()


@router.post("/dip/merger", tags=["Microplan"])
async def merge_dip_and_maps(
        maps_path: UploadFile = File(...), dip_path: UploadFile = File(...), lgas: str=None, state: State=None):
    """
    Merge DIP and Team Guide Maps to generate LGA workbooks

    Parameters
    ----------
    maps_path: Zipped folder of team guide maps
    dip_path: Zipped folder of DIP tables
    lgas: list of LGAs to generate map book. Leave blank to generate all
    state: The State of DIP and Team Guide Maps

    Raises
    ------
    InvalidInputError if neither lgas nor state is provided

    Returns
    -------
    Zipped Folder of LGA DIP Map books
    """

    if is_empty(lgas) and state is None:
        raise InvalidInputError('Missing Argument', "Please provide lgas or state")

    with tempfile.TemporaryDirectory() as temp_dir:
        dip_save_path, maps_save_path, map_book_path = f"{temp_dir}//DIPS", f"{temp_dir}//MAPS", f"{temp_dir}//LGA Maps"
        os.makedirs(dip_save_path, exist_ok=True)
        os.makedirs(maps_save_path, exist_ok=True)
        os.makedirs(map_book_path, exist_ok=True)

        dip_zip_path = await save_uploaded_file(dip_path, temp_dir)
        await run_in_threadpool(extract_and_find_file, dip_zip_path, dip_save_path, '.pdf')

        maps_zip_path = await save_uploaded_file(maps_path, temp_dir)
        await run_in_threadpool(extract_and_find_file, maps_zip_path, maps_save_path, '.csv')

        def merge_and_zip() -> BytesIO:
            output_pdfs: list = merge_maps_to_dips(dip_save_path, maps_save_path, map_book_path, lgas=lgas, state=state)

            archive = BytesIO()
            with zipfile.ZipFile(archive, 'w', allowZip64=True) as zip_file:
                for map_book in tqdm(output_pdfs, desc='Adding To Zip Archive'):
                    zip_file.write(map_book, arcname=os.path.join("LGA Map Book.zip", os.path.basename(map_book)))

            archive.seek(0)
            return archive

        # Merging the PDFs is the slow part; the temporary folder stays until the zip is built.
        zip_buffer = await run_heavy(merge_and_zip)
        return StreamingResponse(
            zip_buffer,
            media_type="application/x-zip-compressed",
            headers={"Content-Disposition": f'attachment; filename="DIP LGA Mapbook.zip"'}
        )


@router.post("/dip/validator", tags=["Microplan"])
async def validate_microplan(settlements_file: UploadFile = File(...), team_allocation_file: UploadFile = Form(...)):
    """
    Validate the Microplan Daily Implementation Plan based on the Day of Activity and Team Allocation.<br>
    Checks include:
        1. Assigned teams is not less than allocated teams
        2. Each Team is working for the 4-day duration of the activity
        3. Any Missing teams

    Parameters
    ----------
    settlements_file (CSV/Excel):
        CSV or Excel of Settlements

    team_allocation_file (CSV/Excel):
        CSV or Excel of Team Allocation containing LGA, Ward and H2H teams

    Returns
    -------
    Excel File containing the Ward, Team and DIP Reviews
    """

    dip_df = await read_dataset(settlements_file)
    team_distribution_df = await read_dataset(team_allocation_file) if team_allocation_file else None
    validation_datasets: dict[str, pd.DataFrame] = await run_heavy(validate_daily_implementation_plan, dip_df, team_distribution_df)

    def write_workbook(path: str) -> None:
        with pd.ExcelWriter(path, engine='openpyxl') as writer:
            for title, df in tqdm(validation_datasets.items(), desc='Writing to Excel'):
                sheet_name = title.replace('_', ' ').title()
                df.to_excel(writer, sheet_name=sheet_name, index=False)

    return await afile_response(
        write_workbook, '.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        f"{settlements_file.filename} Validation.xlsx")


@router.post("/dip/generator", tags=["Microplan"])
async def generate_daily_implementation_plan(
        dip_file: UploadFile = File(...), validate_dip: bool=Form(False),
        team_allocation_file: UploadFile = File(None)):
    """


    Parameters
    ----------
    dip_file
    validate_dip
    team_allocation_file

    Returns
    -------

    """

    dip_data = await read_dataset(dip_file)

    if validate_dip and not team_allocation_file:
        raise InvalidInputError(
            'Missing Argument', "Please provide team allocation since validation is True")

    team_allocation_data = await read_dataset(team_allocation_file) if team_allocation_file else None

    def build_zip() -> BytesIO:
        results, dip_pdfs = generate_team_dips(dip_data, validate_dip, team_allocation_data)

        archive = BytesIO()
        with zipfile.ZipFile(archive, "w") as zip_file:
            for dip_pdf in tqdm(dip_pdfs, "Adding To ZIP Archive"):
                zip_file.write(dip_pdf, arcname=os.path.join("DIPS.zip", os.path.basename(dip_pdf)))

            # The workbook only needs to exist long enough to be copied into the zip.
            workbook_path = new_result_file('.xlsx')
            try:
                with pd.ExcelWriter(workbook_path, engine='openpyxl') as writer:
                    for title, df in tqdm(results.items(), desc='Writing to Excel'):
                        sheet_name = title.replace('_', ' ').title()
                        df.to_excel(writer, sheet_name=sheet_name, index=False)

                out_name = generate_output_name(dip_file.filename, ext='xlsx', suffix='DIP')
                zip_file.write(workbook_path, arcname=os.path.join("DIPS.zip", out_name))
            finally:
                remove_file(workbook_path)

            # add_to_archive(zip_file, std_dip_data, "DIP.csv")

        archive.seek(0)
        return archive

    # Generating the PDFs and the workbook is the slow part of this route: keep it off the event loop.
    zip_buffer = await run_heavy(build_zip)

    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="DIP Output.zip"'}
    )
