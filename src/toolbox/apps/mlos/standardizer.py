import logging

from fastapi import APIRouter, UploadFile

from toolbox.tools import generate_output_name
from toolbox.utils import timer, logger
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.transform import standardize_mlos_records
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

router = APIRouter()
logger(log_name='Standardize')

@timer
@router.post('/qc/standardize', tags=['MLoS'])
async def standardize_mlos(mlos_file_path: UploadFile):
    """Carry out Standardization operations to the MLoS data.<br>

    This includes:<br>
        - Removal of Whitespaces (leading, trailing and in-between words).<br>
        - Capitalize Attributes.<br>
        - Converting Abbreviations to Full words.

    Parameters
    ------------
    mlos_file_path: UploadFile
        Location of MLoS data

    Returns
    ---------
        FileResponse: Downloadable CSV file containing standardized data

    """
    logging.info('Standardization MLoS Records')
    mlos_data = await read_dataset(mlos_file_path)

    print('Standardizing MLOS...')
    standardized_mlos = await run_heavy(standardize_mlos_records, mlos_data)
    logging.info('Exporting Standardized Data')
    save_name = generate_output_name(mlos_file_path.filename, 'csv', 'standardized')
    return await afile_response(lambda path: standardized_mlos.to_csv(path, index=False), '.csv', 'text/csv', save_name)
