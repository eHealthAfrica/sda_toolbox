from fastapi import APIRouter, UploadFile, Form

# from toolbox.tools import write_in_memory_zip
from toolbox.tools import find_column
from toolbox.access.read_mgr import read_dataset
from toolbox.reporting.create_reports import generate_post_implementation_report, PostReport

router = APIRouter()


@router.post('/reports/post', tags=['Reports'], response_model=list[PostReport])
async def generate_post_implementation_reports(settlement_list: UploadFile, report_col: str = Form(...)) -> list[PostReport]:
    """
    Generates all Charts and Graphs for a Campaign post implementation report

    Parameters
    ----------
    settlement_list: UploadFile
        Campaign settlements containing LGA, Ward and Column of final visitation status

    report_col: str
        The Final Visitation Status Column. Defaults to Visitation

    Returns
    -------
        list of PostReport
    """

    tracking_data = await read_dataset(settlement_list)
    report_col = find_column(tracking_data, report_col, 'raise')

    post_report: list[PostReport] = generate_post_implementation_report(tracking_data, report_col)
    # zip_buffer = write_in_memory_zip(post_implementation_report, post_report, lga_list=lgas)

    return post_report
