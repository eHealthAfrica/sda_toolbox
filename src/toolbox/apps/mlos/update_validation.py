from fastapi.responses import FileResponse
from fastapi import APIRouter, UploadFile
from tqdm import tqdm
import pandas as pd
import openpyxl
import tempfile

from toolbox.mlos.transformers import common_transformations
from toolbox.access.read.spatial_handler import ESRIHandler
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import FileNotFound
from toolbox.mlos.validation import update
from toolbox.models import Policy
from toolbox.tools import generate_output_name

router = APIRouter()


async def process_validated_data(validated_data_files: list[UploadFile]|UploadFile):
    # Todo! rework to read workbook and map sheet_name and data as output
    excel_files = [file for file in validated_data_files if file.filename.endswith('xlsx')]
    csv_files = [file for file in validated_data_files if file.filename.endswith('csv')]
    all_datasets = []

    if excel_files:
        with tempfile.TemporaryDirectory() as temp_dir:
            saved_files = [await ESRIHandler.save_uploaded_file(file, temp_dir) for file in excel_files]

            excel_map: dict[UploadFile, list[str]] = {
                lga_file: openpyxl.load_workbook(lga_file).sheetnames
                for lga_file in tqdm(saved_files, desc='loading excel workbooks')
            }

            for file, sheet_names in tqdm(excel_map.items(), desc='Reading Workbooks'):
                excel_datasets = [
                    await read_dataset(file, is_spatial=False, sheet=sheet_name)
                    for sheet_name in sheet_names
                    ]
                all_datasets.extend(excel_datasets)

    if csv_files:
        csv_datasets = [await read_dataset(csv_file) for csv_file in tqdm(csv_files, desc='reading csv files')]
        all_datasets.extend(csv_datasets)

    if not all_datasets:
        raise FileNotFound('No files found', 'No Compatible Validation Dataset files were uploaded')

    all_datasets = [common_transformations(dataset) for dataset in all_datasets]
    validated_dataset = pd.concat(all_datasets, ignore_index=True)
    return validated_dataset


@router.patch('/mlos/validation',  tags=['MLoS'])
async def update_validation_data(
        mlos_file: UploadFile, lga_validation_files: list[UploadFile] | UploadFile, purpose: Policy):
    """
    Combine and update the validated MLoS

    Parameters
    ----------
    mlos_file
    lga_validation_files
    purpose

    Returns
    -------

    """


    validation_dataset = await process_validated_data(lga_validation_files)
    mlos_data = await read_dataset(mlos_file)
    mlos_cols = [col for col in mlos_data.columns]
    updated_mlos = update.update_mlos(mlos_data, validation_dataset, purpose)
    updated_mlos = updated_mlos.loc[:, mlos_cols]

    temp_file = tempfile.NamedTemporaryFile(suffix='.csv', delete=False)
    updated_mlos.to_csv(temp_file.name, index=False)

    save_name = generate_output_name(mlos_file.filename, 'csv', 'updated')

    return FileResponse(
        temp_file.name,
        filename=save_name,
        media_type='text/csv'
    )
    