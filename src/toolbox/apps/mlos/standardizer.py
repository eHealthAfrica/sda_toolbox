import tempfile
import logging

from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.tools import generate_output_name
from toolbox.utils import timer, logger
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.transform import standardize_mlos_records

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
    standardized_mlos = standardize_mlos_records(mlos_data)
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
    standardized_mlos.to_csv(temp_file.name, index=False)
    temp_file.close()

    logging.info('Exporting Standardized Data')
    save_name = generate_output_name(mlos_file_path.filename, 'csv', 'standardized')
    return FileResponse(
        temp_file.name,
        media_type="text/csv",
        filename=save_name
    )