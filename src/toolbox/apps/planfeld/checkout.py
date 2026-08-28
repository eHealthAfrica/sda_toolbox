from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse

from toolbox.access.read_mgr import read_dataset
from toolbox.models import State

router = APIRouter()


@router.post('/checkout', tags=['Microplan'])
async def update_checkout(settlement: UploadFile = File(...), db_checkout: UploadFile = File(...), state: State=Form(None)) -> FileResponse:
    """
    Update Spatial Lite MLoS and Takeoff Point checkout with MLoS.
    Parameters
    ----------
    settlement: Settlement list file
    db_checkout: Spatial Lite DB of previous Settlement records containing settlement list and takeoff point tables
    state: State of Analyst/Analysis

    Returns
    -------
    FileResponse of Updated Spatial Lite DB
    """
    ...