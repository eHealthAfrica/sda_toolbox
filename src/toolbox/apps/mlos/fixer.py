import pandas as pd
from fastapi import APIRouter, UploadFile

from toolbox.models import State
from toolbox.utils import logger, timer
from toolbox.utils.offload import run_heavy
from toolbox.tools import generate_output_name
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import InvalidInputError
from toolbox.utils.tempfiles import afile_response
from toolbox.fixers import auto_shift_points, populate_global_id, populate_takeoff_point

logger(log_name='MLoS Fixer')
router = APIRouter()


@timer(title='QC Fixer')
@router.patch('/qc/fixer', tags=['MLoS'])
async def fix_operations(settlement_file: UploadFile, shift_points: bool=False, set_global_id: bool=False,
                         populate_takeoff: bool=False, state: State = None):
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
    state: State
        defaults to None, only required is shifting point operation will be required

    Returns
    ---------
        FileResponse: downloadable csv file of updated MLoS data

    """

    settlement_data: pd.DataFrame = await read_dataset(settlement_file)

    if shift_points and state is None:
        raise InvalidInputError(
            'state info is required',
            'state information is needed to retrieve ward and settlement extent boundary from GDB')

    def apply_fixes(data: pd.DataFrame) -> pd.DataFrame:
        if shift_points:
            print("Shifting Points with Proximity Issues")
            settlements_with_coords = data.loc[data['latitude'].notnull()]
            settlements_without_coords = data.loc[data['latitude'].isnull()]
            shifted_data = auto_shift_points(settlements_with_coords, state)
            data = pd.concat([shifted_data, settlements_without_coords], ignore_index=True)

        if set_global_id:
            print("Creating New global id for MLoS")
            data = populate_global_id(data)

        if populate_takeoff:
            print("Populating Take-off-point")
            data = populate_takeoff_point(data)

        return data

    # Shifting points, takeoff points and the duplicate search each run for minutes: keep them off the event loop.
    settlement_data = await run_heavy(apply_fixes, settlement_data)

    save_name = generate_output_name(settlement_file.filename, 'csv', 'fixed')
    return await afile_response(lambda path: settlement_data.to_csv(path, index=False), '.csv', 'text/csv', save_name)
