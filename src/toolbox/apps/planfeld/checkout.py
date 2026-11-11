import json

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse
import geopandas as gpd

from toolbox.access.read_mgr import read_dataset
from toolbox.utils.tempfiles import delete_after_response
from toolbox.mlos.planfeld.checkout_mgr.sync_db import Checkout, synchronize_checkout_datasets

router = APIRouter()


@router.post('/campaign/checkout', tags=['Campaign'])
async def update_checkout(
        settlement: UploadFile = File(...),
        db_checkout: UploadFile = File(...),
        new_takeoff: UploadFile= File(None)) -> FileResponse:
    """
    Update Spatial Lite MLoS and Takeoff Point checkout with MLoS.
    Parameters
    ----------
    settlement: Settlement list file
    db_checkout: Spatial Lite DB of previous Settlement records containing settlement list and takeoff point tables
    new_takeoff: New Takeofff point table with coordinates

    Returns
    -------
    FileResponse of Updated Spatial Lite DB
    """
    ...

    settlements = await read_dataset(settlement)
    new_takeoff_data = await read_dataset(new_takeoff) if new_takeoff else gpd.GeoDataFrame()
    checkout_ds = Checkout(db_checkout)
    # The uploaded checkout is copied and the copy is changed; the copy is deleted once the response is sent.
    result = await synchronize_checkout_datasets(settlements, checkout_ds, new_takeoff_data)
    updated_checkout: str = result.path

    return FileResponse(
        updated_checkout,
        filename=db_checkout.filename,
        media_type="application/vnd.sqlite3",
        background=delete_after_response(updated_checkout),
        # The numbers the Checkout page shows; listed in sda_toolbox.py's CORS expose_headers.
        headers={'X-Checkout-Summary': json.dumps(result.summary)},
    )
