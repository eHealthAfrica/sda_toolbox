from typing import Optional

from fastapi import APIRouter, UploadFile
from fastapi.responses import StreamingResponse

from toolbox.mlos import get_admin_col
from toolbox.access.read_mgr import read_dataset
from toolbox.tools import find_column, detect_number
from toolbox.reporting import DailyReport
from toolbox.tools import write_in_memory_zip
from toolbox.exceptions import InvalidInputError, ResourcesError

router = APIRouter()


@router.post('/reports/daily', tags=['Reports'])
async def generate_campaign_daily_report(
        settlement_list: UploadFile, campaign_day_col: Optional[str]=None, cumulative_day_col: Optional[str]=None):
    """
    Generate Campaign Day Reports

    Parameters
    ----------
    settlement_list: UploadFile
        Settlement list file containing LGA and the current campaign day report column

    campaign_day_col: str
        The current campaign day report column. Defaults to Visitation

    cumulative_day_col: str
        The cumulative visitation campaign day column

    Raises
    -----------
        InvalidInputError if neither the campaign day nor the cumulative campaign day columns are provided.
        DataError: If the report columns are not found in the uploaded dataset.

    Returns
    -------
        FileResponse: Zipped File of Charts and Graphs Image Reports
    """
    raise ResourcesError('Not Available', 'This service is currently under development')

    settlement_data = await read_dataset(settlement_list)
    if not campaign_day_col and not cumulative_day_col:
        raise InvalidInputError(
            'Invalid Report Column Input',
            'You must provide at least 1 of the 2 reporting columns; campaign or cumulative day col.')

    cols = {'cumulative': cumulative_day_col, 'day': campaign_day_col}
    cols = {key: find_column(settlement_data, value) for key, value in cols.items() if isinstance(value, str)}
    reporter = Reporters(**cols)

    lga_col = get_admin_col(settlement_data, 'lga', 'raise')
    daily_report = DailyReport(settlement_data, reporter, lga_col)
    image_reports = daily_report.generate_report()

    campaign_day = detect_number(campaign_day_col)
    zip_buffer = write_in_memory_zip(daily_report, image_reports, campaign_day)

    return StreamingResponse(
        zip_buffer,
        media_type='application/zip',
        headers={'Content-Disposition': 'attachment; filename="campaign_day_report.zip"'}
    )
