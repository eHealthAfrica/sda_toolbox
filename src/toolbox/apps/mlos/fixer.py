import tempfile

import pandas as pd
from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.mlos import get_admin_col, detect_unique_admin_field, construct_new_unique
from toolbox.models import State
from toolbox.spatial_mgr import GeomColumns
from toolbox.tools import generate_output_name
from toolbox.utils import logger, timer
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import InvalidInputError
from toolbox.fixers import auto_shift_points, populate_global_id, populate_takeoff_point
from toolbox.mlos.validation.review import duplicate_deep_search_protocol

logger(log_name='MLoS Fixer')
router = APIRouter()


@timer(title='QC Fixer')
@router.patch('/qc/fixer', tags=['MLoS'])
async def fix_operations(settlement_file: UploadFile, shift_points: bool=False, set_global_id: bool=False,
                         populate_takeoff: bool=False, duplicate_check: bool=False, state: State = None):
    """Fix and Populate MLoS data.

    Parameters
    --------------
    settlement_file: UploadFile
        MLoS file path<br>
    shift_points: bool
        move points that violate the 30m proximity limit<br>
    set_global_id: bool
        populate records with no global id entry with new unique ids<br
    populate_takeoff: bool
        assign takeoff points to data<br>
    duplicate_check: bool
        Conducts a deep (non-direct) duplicate on the settlements
    state: State
        defaults to None, only required is shifting point operation will be required

    Returns
    ---------
        FileResponse: downloadable csv file of updated MLoS data

    """

    settlement_data: pd.DataFrame = await read_dataset(settlement_file)

    if shift_points:
        if shift_points and state is None:
            raise InvalidInputError(
                'state info is required',
                'state information is needed to retrieve ward and settlement extent boundary from GDB')

        print("Shifting Points with Proximity Issues")
        settlements_with_coords = settlement_data.loc[settlement_data['latitude'].notnull()]
        settlements_without_coords = settlement_data.loc[settlement_data['latitude'].isnull()]
        shifted_data = auto_shift_points(settlements_with_coords, state)
        settlement_data = pd.concat([shifted_data, settlements_without_coords], ignore_index=True)

    if set_global_id:
        print("Creating New global id for MLoS")
        settlement_data = populate_global_id(settlement_data)

    if populate_takeoff:
        print("Populating Take-off-point")
        settlement_data = populate_takeoff_point(settlement_data)

    if duplicate_check:
        unique_code = detect_unique_admin_field(settlement_data)
        if not unique_code:
            unique_code = 'unique_code'
            settlement_data = construct_new_unique(settlement_data, unique_code)

        geom = GeomColumns.get_geom_cols(settlement_data, True)
        settlement_data = duplicate_deep_search_protocol(settlement_data, 'ward', unique_code, geom, 'update')

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
    settlement_data.to_csv(temp_file.name, index=False)
    temp_file.close()

    save_name = generate_output_name(settlement_file.filename, 'csv', 'fixed')

    # Return the file as a response
    return FileResponse(
        temp_file.name,
        media_type="text/csv",
        filename=save_name
    )
