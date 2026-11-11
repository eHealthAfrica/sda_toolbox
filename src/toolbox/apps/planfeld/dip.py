from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse

from toolbox.utils import logger
from toolbox.tools import generate_output_name
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.planfeld import populate_daily_implementation_plan
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

router = APIRouter()
logger(log_name='Microplan')


@router.post('/microplan', tags=['Microplan'])
async def extract_daily_plan(dip_file: UploadFile = File(...)) -> FileResponse:
    dip = await read_dataset(dip_file)

    populated_dip = await run_heavy(populate_daily_implementation_plan, dip)
    save_name = generate_output_name(dip_file.filename, 'csv', 'DIP')
    return await afile_response(lambda path: populated_dip.to_csv(path, index=False), '.csv', 'text/csv', f'{save_name}.csv')


