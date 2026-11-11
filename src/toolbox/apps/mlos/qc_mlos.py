import numpy as np
import pandas as pd
from fastapi import APIRouter, UploadFile

from toolbox.models import State
from toolbox.utils import timer, logger
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.transform import standardize_mlos_records
from toolbox.tools import issues_counter, generate_output_name
from toolbox.mlos.validation.review.run_validate import run_settlements_qc
from toolbox.mlos import get_admin_col, detect_unique_admin_field, construct_new_unique
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response


router = APIRouter()
logger(log_name='MLoS QC')

def flag_settlements(settlement_data: pd.DataFrame, report_cols: list[str]):
    query = " | ".join([f"({col}.notnull())" for col in report_cols])
    settlement_data.eval(f"is_flagged={query}", engine='python', inplace=True)
    settlement_data['is_flagged'].replace({True: 'Flagged', False: np.nan}, inplace=True)

    issues_counter(settlement_data, 'is_flagged', 'Total Flagged', suffix=True)
    return settlement_data


@timer(title='MLoS Validation')
@router.post('/qc/validation', tags=['MLoS'])
async def validate_mlos(mlos_file_path: UploadFile, standardize: bool=None, consistency: bool=True, deep_search: bool=None):
    """
    Conduct Comprehensive QC on MLoS data including spatial and attributes checks

    Parameters
    -----------
    mlos_file_path: str
        file path of the mlos data <br>

    standardize: bool
        standardize MLoS before running QC. The Default value is True. Set to False or leave blank to run QC based on MLoS
        records.

    consistency: bool
        set to True to check for consistency between attributes information. Such as checking if a settlement has been
        security compromised but fully accessible.

    deep_search: bool
        conducts a fuzzy search for duplicate unique attributes. Default value is false

    Returns
    --------
        FileResponse: downloadable CSV File of Checked MLoS data

    """

    mlos_data: pd.DataFrame = await read_dataset(mlos_file_path)
    get_admin_col(mlos_data, 'state', 'raise')

    def prepare(data: pd.DataFrame) -> tuple[pd.DataFrame, str]:
        if standardize:
            print('Standardizing MLoS Records')
            data = standardize_mlos_records(data)

        unique_col = detect_unique_admin_field(data)
        if not unique_col:
            unique_col = 'unique_code'
            data = construct_new_unique(data, unique_col)
        return data, unique_col

    mlos_data, unique_col = await run_heavy(prepare, mlos_data)

    qc_ed_mlos: pd.DataFrame = await run_settlements_qc(mlos_data, unique_col, consistency, deep_search)

    save_name = generate_output_name(mlos_file_path.filename, 'csv', 'QC')
    return await afile_response(lambda path: qc_ed_mlos.to_csv(path, index=False), '.csv', 'text/csv', save_name)


if __name__ == '__main__':
    import asyncio
    mlos_file = r"C:\Workspace\NEOC\IBRA\August Round\Compiled MLoS.xlsx"
    asyncio.run(
        validate_mlos(mlos_file,True, False)
    )