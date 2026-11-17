from typing import Literal

import numpy as np
import pandas as pd
from tqdm import tqdm
from fastapi import UploadFile, APIRouter
from fastapi.responses import FileResponse

from toolbox.configs import CONFIG
from toolbox.tools import generate_output_name
from toolbox.access.read_mgr import read_dataset
from toolbox.tools.excel_tools import add_borders, add_data_validation_rules
from toolbox.mlos import get_admin_col, detect_unique_admin_field, MLoSAttributes
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

router = APIRouter()


@router.post('/compiler/disaggregate', tags=['Compiler'])
async def disaggregate_mlos(mlos_file: UploadFile, level: Literal['State', 'LGA', 'Ward']) -> FileResponse:
    """
    Disaggregate Settlements by ward.

    Parameters
    ----------
    mlos_file: UploadFile
        Master List of Settlement File.
    level: Literal['lga', 'ward']
        Administrative level to disaggregate settlements by.

    Returns
    -------
        FileResponse: Downloadable Excel file with settlements broken into their respective administrative levels.

    """
    mlos_data = await read_dataset(mlos_file)
    level = level.lower()

    def prepare():
        data_copy = mlos_data.copy()
        state, lga, ward = [get_admin_col(mlos_data, col) for col in ['state', 'lga', 'ward']]
        unique_col = detect_unique_admin_field(mlos_data)
        attrs = MLoSAttributes()(data_copy, CONFIG['ATTRIBUTE_COLUMNS'])
        mlos_data.loc[:, ['Comment']] = np.nan
        initial_cols = mlos_data.columns.tolist()

        if level == 'state':
            level_code = state
            title = level.title()
        elif level == 'lga':
            level_code = 'unique_lga_code'
            mlos_data[level_code] = mlos_data[state] + "_" + mlos_data[lga]
            title = level.upper()
        else:
            level_code = 'unique_ward_code'
            mlos_data[level_code] = mlos_data[state] + "_" + mlos_data[lga] + "_" + mlos_data[ward]
            title = level.title()

        data_level_group = mlos_data.groupby(level_code)
        cols_to_drop = [
            'globalid', 'validation_status', 'master.id',
            'mlos_id', 'source', 'unique_ward_code', 'unique_lga_code',
        ]

        cols_to_drop = [col for col in cols_to_drop if col not in initial_cols]
        return attrs, data_level_group, cols_to_drop, title

    # Building the attributes and the groups touches the whole upload: keep it off the event loop.
    attrs, data_level_group, cols_to_drop, title = await run_heavy(prepare)

    def write_workbook(path: str) -> None:
        with pd.ExcelWriter(path, engine='openpyxl') as writer:
            for level_code, level_data in tqdm(data_level_group, total=len(data_level_group), desc=f"Writing {level} data"):
                sheet_name = " ".join(level_code.replace("/", "-").split("_"))[:31]
                level_data.drop(columns=cols_to_drop, inplace=True, errors='ignore')

                # Todo: Include Data Validation Rules
                level_data.to_excel(writer, sheet_name=sheet_name, index=False)
                add_borders(writer, sheet_name, len(level_data.columns), len(level_data))
                add_data_validation_rules(writer, attrs.preset_attributes, sheet_name, level_data)

    output_name = generate_output_name(mlos_file.filename, 'xlsx', f"{title} Level")
    return await afile_response(
        write_workbook, '.xlsx',
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", output_name)
