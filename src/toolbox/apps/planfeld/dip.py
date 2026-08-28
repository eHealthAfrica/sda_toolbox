import tempfile

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse

from toolbox.utils import logger
from toolbox.tools import generate_output_name
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.planfeld import populate_daily_implementation_plan

router = APIRouter()
logger(log_name='Microplan')


@router.post('/microplan', tags=['Microplan'])
async def extract_daily_plan(dip_file: UploadFile = File(...)) -> FileResponse:
    dip = await read_dataset(dip_file)

    populated_dip = populate_daily_implementation_plan(dip)
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.csv')
    populated_dip.to_csv(tmp_file, index=False)
    tmp_file.close()

    save_name = generate_output_name(dip_file.filename, 'csv', 'DIP')
    return FileResponse(
        tmp_file.name,
        media_type='text/csv',
        filename=f'{save_name}.csv'
    )


