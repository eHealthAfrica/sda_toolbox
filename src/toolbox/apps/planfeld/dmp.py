import io
import re
import zipfile
import tempfile
from typing import Literal

import pandas as pd
from tqdm import tqdm
from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.utils import timer, logger
from toolbox.mlos.planfeld import populate_daily_implementation_plan

router = APIRouter()
logger(log_name='DMP Aggregator')


@timer(title='DMP Files Aggregation')
def extract_and_retrieve_datasets(dmp_files: UploadFile) -> dict[str, pd.DataFrame]:

    datasets = {}
    with zipfile.ZipFile(dmp_files.file, 'r') as zip_ref:
        for file_info in tqdm(zip_ref.infolist(), desc='Processing DMP files'):
            original_filename = file_info.filename
            if not original_filename.endswith('.csv'):
                continue

            lga_name = original_filename.split('—')[-1].strip().removesuffix('.zip').replace('.csv', '')
            data = zip_ref.read(original_filename)
            df = pd.read_csv(io.BytesIO(data))
            datasets[lga_name] = df

    return datasets


@router.post('/aggregator/dmp/combine', tags=['Microplan'])
async def combine_dmp_files(dmp_files: UploadFile, dip: Literal['expand', 'keep']='keep') -> FileResponse:
    """
    Combine multiple Digitized Micro Plan CSV files into a single Excel file with separate sheets for each input file.

    Parameters
    ----------
    dmp_files: UploadFile
        A zip file containing multiple DMP CSV files.

    dip: Literal['expand', 'keep']
        Specify expand to expand the implementation days into their respective columns or keep Days as its default state.

    Returns
    -------
        FileResponse: Downloadable Excel file containing combined DMP data.
    """

    datasets = extract_and_retrieve_datasets(dmp_files)
    # Todo: Add a function that splits the outcome into settlements and special places {dict, [df, df]}
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')
    
    with pd.ExcelWriter(temp_file, engine='openpyxl') as writer:
        for sheet_name, df in tqdm(datasets.items(), desc='Writing to Excel'):
            if dip == 'expand':
                df = populate_daily_implementation_plan(df)

            df.to_excel(writer, sheet_name=sheet_name[:31], index=False)

    temp_file.close()

    return FileResponse(
        path=temp_file.name,
        filename="combined_dmp.xlsx",
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )