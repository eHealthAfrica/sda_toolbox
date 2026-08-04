import tempfile
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

router = APIRouter()


@router.post('/compiler/disaggregate', tags=['Compiler'])
async def disaggregate_mlos(mlos_file: UploadFile, level: Literal['LGA', 'Ward']) -> FileResponse:
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
    data_copy = mlos_data.copy()
    lga, ward = [get_admin_col(mlos_data, col) for col in ['lga', 'ward']]
    unique_col = detect_unique_admin_field(mlos_data)
    attrs = MLoSAttributes()(data_copy, CONFIG['ATTRIBUTE_COLUMNS'])
    mlos_data.loc[:, ['Comment']] = np.nan
    initial_cols = mlos_data.columns.tolist()

    level = level.lower()
    if level == 'lga':
        level_code = lga
        title = level.upper()
    else:
        level_code = 'unique_ward_code'
        mlos_data[level_code] = mlos_data[lga] + "_" + mlos_data[ward]
        title = level.title()

    data_level_group = mlos_data.groupby(level_code)
    cols_to_drop = [
        'globalid', 'validation_status', 'master.id',
        'mlos_id', 'source', 'unique_ward_code'
    ]

    cols_to_drop = [col for col in cols_to_drop if col not in initial_cols]

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')
    with pd.ExcelWriter(temp_file, engine='openpyxl') as writer:
        for level_code, level_data in tqdm(data_level_group, total=len(data_level_group), desc=f"Writing {level} data"):
            sheet_name = " ".join(level_code.replace("/", "-").split("_"))[:31]
            level_data.drop(columns=cols_to_drop, inplace=True, errors='ignore')

            # Todo: Include Data Validation Rules
            level_data.to_excel(writer, sheet_name=sheet_name, index=False)
            add_borders(writer, sheet_name, len(level_data.columns), len(level_data))
            add_data_validation_rules(writer, attrs.preset_attributes, sheet_name, level_data)


    temp_file.close()
    output_name = generate_output_name(mlos_file.filename, 'xlsx', f"{title} Level")
    return FileResponse(
        temp_file.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=output_name
    )
