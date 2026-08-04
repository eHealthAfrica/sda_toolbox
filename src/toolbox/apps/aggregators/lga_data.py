import tempfile
from typing import Optional

import pandas as pd
from tqdm import tqdm
from fastapi import UploadFile, APIRouter
from fastapi.responses import FileResponse

from toolbox.exceptions import NotSupportedError
from toolbox.models import State, Extensions, Policy
from toolbox.access.read.spatial_handler import ESRIHandler
from toolbox.mlos.transformers.common import common_transformations
from toolbox.mlos.validation.update import standardize_admin_records
from toolbox.tools import extract_and_find_file, generate_output_name
from toolbox.access.read_mgr import read_dataset, get_excel_sheet_names

router = APIRouter()


@router.post('/compiler/lga_data', tags=['Compiler'])
async def combine_lga_data(lga_file: UploadFile, file_extension: Optional[Extensions]=None, state: Optional[State]=None):
    """
    Combine MLoS Validation Data from different LGAs into a single dataset and updates the MLoS

    Parameters
    ----------
    lga_file: Zipped file containing LGA Validation data
    file_extension: Extension of Zipped files
    state: State

    Returns
    -------
        UploadFile
    """
    upload_extension = lga_file.filename.split(".")[-1]
    acceptable_extensions = ['xls', 'xlsx', 'zip', 'csv']
    if upload_extension not in acceptable_extensions:
        raise NotSupportedError("input file extension is not supported", f"the file of extension {upload_extension} is currently not supported")

    all_datasets = []
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_files = await ESRIHandler.save_uploaded_file(lga_file, temp_dir)
        if upload_extension == 'zip':
            data_files = extract_and_find_file(temp_files, temp_dir, file_extension.value)
        else:
            data_files = temp_files


        excel_map = get_excel_sheet_names(data_files)

        for file, sheet_names in tqdm(excel_map.items(), desc='Reading Workbooks'):
            excel_datasets = [
                await read_dataset(file, is_spatial=False, sheet=sheet_name)
                for sheet_name in sheet_names
            ]
            all_datasets.extend(excel_datasets)

    all_datasets = [common_transformations(dataset) for dataset in all_datasets]
    validated_dataset = pd.concat(all_datasets, ignore_index=True)
    validated_dataset = standardize_admin_records(validated_dataset, Policy.MP)

    temp_file = tempfile.NamedTemporaryFile(suffix='.csv', delete=False)
    validated_dataset.to_csv(temp_file.name, index=False)

    save_name = generate_output_name(lga_file.filename, 'csv', 'compiled')
    return FileResponse(
        save_name,
        filename='collated_lga_data.csv',
        media_type='text/csv'
    )


