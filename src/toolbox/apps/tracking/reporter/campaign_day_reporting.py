from fastapi import APIRouter, UploadFile
from fastapi.responses import StreamingResponse

from toolbox.access.read_mgr import read_dataset
from toolbox.tools import detect_number
from toolbox.reporting import DailyReport, PostReport
from toolbox.tools import write_in_memory_zip

router = APIRouter()


@router.post('/reports/daily', tags=['Reports'], response_model=list[PostReport])
async def generate_campaign_daily_report(
        settlement_list: UploadFile, campaign_day_col: str, coverage_col: str):
    """
    Generate Campaign Day Reports

    Parameters
    ----------
    settlement_list: UploadFile
        Settlement list file containing LGA and the current campaign day report column

    campaign_day_col: str
        The current campaign day report column. Defaults to Visitation

    coverage_col: str
        The Settlement Coverage Column


    Returns
    -------
        FileResponse: Zipped File of Charts and Graphs Image Reports
    """

    settlement_data = await read_dataset(settlement_list)
    daily_report = DailyReport(settlement_data, coverage_col, campaign_day_col)
    image_reports = daily_report.generate_report()

    # campaign_day = detect_number(campaign_day_col)
    # zip_buffer = write_in_memory_zip(daily_report, image_reports, campaign_day)

    return image_reports
