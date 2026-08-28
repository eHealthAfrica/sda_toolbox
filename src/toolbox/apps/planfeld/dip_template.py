from io import BytesIO
import tempfile
import zipfile
import os

from fastapi.responses import FileResponse, StreamingResponse
from fastapi import APIRouter, UploadFile, File, Form
from tqdm import tqdm
import pandas as pd

from toolbox.mlos.planfeld import generate_team_dips, validate_daily_implementation_plan, merge_maps_to_dips
from toolbox.tools import save_uploaded_file, extract_and_find_file, is_empty, generate_output_name
from toolbox.access.export_mgr import add_to_archive
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import InvalidInputError
from toolbox.models import State

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
        extract_and_find_file(dip_zip_path, dip_save_path, '.pdf')
        maps_zip_path = await save_uploaded_file(maps_path, temp_dir)
        extract_and_find_file(maps_zip_path, maps_save_path, '.csv')

        output_pdfs: list = merge_maps_to_dips(dip_save_path, maps_save_path, map_book_path, lgas=lgas, state=state)

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', allowZip64=True) as zip_file:
            for map_book in tqdm(output_pdfs, desc='Adding To Zip Archive'):
                zip_file.write(map_book, arcname=os.path.join("LGA Map Book.zip", os.path.basename(map_book)))

        zip_buffer.seek(0)
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
    validation_datasets: dict[str, pd.DataFrame] = validate_daily_implementation_plan(dip_df, team_distribution_df)

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')
    with pd.ExcelWriter(temp_file, engine='openpyxl') as writer:
        for title, df in tqdm(validation_datasets.items(), desc='Writing to Excel'):
            sheet_name = title.replace('_', ' ').title()
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    temp_file.close()

    return FileResponse(
        temp_file.name,
        filename=f"{settlements_file.filename} Validation.xlsx",
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


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

    results, dip_pdfs = generate_team_dips(dip_data, validate_dip, team_allocation_data)
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zip_file:
        for dip_pdf in tqdm(dip_pdfs, "Adding To ZIP Archive"):
            zip_file.write(dip_pdf, arcname=os.path.join("DIPS.zip", os.path.basename(dip_pdf)))

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')

        with pd.ExcelWriter(temp_file, engine='openpyxl') as writer:
            for title, df in tqdm(results.items(), desc='Writing to Excel'):
                sheet_name = title.replace('_', ' ').title()
                df.to_excel(writer, sheet_name=sheet_name, index=False)

        temp_file.close()
        out_name = generate_output_name(dip_file.filename, ext='xlsx', suffix='DIP')
        zip_file.write(temp_file.name, arcname=os.path.join("DIPS.zip", out_name))
        # add_to_archive(zip_file, std_dip_data, "DIP.csv")

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="DIP Output.zip"'}
    )
