import tempfile
import logging


import pandas as pd
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse

from toolbox.campaign.contact_analysis import execute_contact_analysis
from toolbox.tools import read_compiled_data, generate_output_name
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos import get_admin_col
from toolbox.utils import logger

router = APIRouter()
logger(log_name='Contact Analysis')

@router.post("/contact_analysis", tags=["Campaign"])
async def inter_campaign_contact_analysis(base_file: UploadFile = File(...), previous_campaign_file: UploadFile = File(...)) -> FileResponse:
    """
    Conducts contact analysis on a baseline settlement list against previous campaigns with visitation and coverage
    Parameters
    ----------
    base_file:
        Baseline Settlement List which will be used for contact analysis. Most contain a

    previous_campaign_file:
        An Excel file where each sheet corresponds to a previous campaign settlement visitation and coverage

    Raises
    -------
        raises an assertion error if the state column is not present in either baseline or any of the previous campaign datasets


    Returns
        FileResponse CSV of computed contact analysis
    """

    base_data = await read_dataset(base_file)
    assert get_admin_col(base_data, 'state')

    previous_campaigns: dict[str, pd.DataFrame] = await read_compiled_data(previous_campaign_file)
    for campaign in previous_campaigns:
        assert get_admin_col(previous_campaigns[campaign], 'state')

    logging.info('Starting contact analysis')
    updated_base_data: pd.DataFrame = await execute_contact_analysis(base_data, previous_campaigns)

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
    updated_base_data.to_csv(temp_file.name, index=False)
    temp_file.close()

    save_name = generate_output_name(base_file.filename, 'csv', 'Contact Analysis')
    return FileResponse(
        temp_file.name,
        media_type="text/csv",
        filename=save_name
    )
