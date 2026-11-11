import tempfile
from typing import Optional

import pandas as pd
from tqdm import tqdm
from fastapi import UploadFile, APIRouter
from starlette.concurrency import run_in_threadpool

from toolbox.exceptions import NotSupportedError
from toolbox.models import State, Extensions, Policy
from toolbox.access.read.spatial_handler import ESRIHandler
from toolbox.mlos.transformers.common import common_transformations
from toolbox.mlos.validation.update import standardize_admin_records
from toolbox.tools import extract_and_find_file
from toolbox.access.read_mgr import read_dataset, get_excel_sheet_names
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

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
            data_files = await run_in_threadpool(extract_and_find_file, temp_files, temp_dir, file_extension.value)
        else:
            data_files = temp_files


        excel_map = await run_in_threadpool(get_excel_sheet_names, data_files)

        for file, sheet_names in tqdm(excel_map.items(), desc='Reading Workbooks'):
            excel_datasets = [
                await read_dataset(file, is_spatial=False, sheet=sheet_name)
                for sheet_name in sheet_names
            ]
            all_datasets.extend(excel_datasets)

    def combine() -> pd.DataFrame:
        transformed = [common_transformations(dataset) for dataset in all_datasets]
        combined = pd.concat(transformed, ignore_index=True)
        return standardize_admin_records(combined, Policy.MP)

    # Transforming and combining every LGA workbook is minutes of pandas work: keep it off the event loop.
    validated_dataset = await run_heavy(combine)

    return await afile_response(
        lambda path: validated_dataset.to_csv(path, index=False), '.csv', 'text/csv', 'collated_lga_data.csv')


