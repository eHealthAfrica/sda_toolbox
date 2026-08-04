from typing import Optional

from fastapi.responses import StreamingResponse
from fastapi import APIRouter, UploadFile, Form

from toolbox.tools import write_in_memory_zip
from toolbox.apps.tracking.reporter import filter_target
from toolbox.reporting import PostImplementationReport, Reporters
from toolbox.tools import process_delimited_input, find_column
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos import get_admin_col

router = APIRouter()


@router.post('/reports/post', tags=['Reports'])
async def generate_post_implementation_reports(
        settlement_list: UploadFile, report_col: str = Form(...), lois:
        Optional[str | list[str]]=None) -> StreamingResponse:
    """
    Generates all Charts and Graphs for a Campaign post implementation report

    Parameters
    ----------
    settlement_list: UploadFile
        Campaign settlements containing LGA, Ward and Column of final visitation status

    report_col: str
        The Final Visitation Status Column. Defaults to Visitation

    lois: Optional[list]
        List of LGAs to generate their reports. Defaults to None (All LGAs in the dataset)

    Returns
    -------
        StreamingResponse: Zipped File of Charts and Graphs Image Reports
    """

    tracking_data = await read_dataset(settlement_list)
    report_col = find_column(tracking_data, report_col, 'raise')

    lga, ward = get_admin_col(tracking_data, 'lga'), get_admin_col(tracking_data, 'ward')
    tracking_data[lga] = tracking_data[lga].str.replace('/', '-')
    tracking_data[ward] = tracking_data[ward].str.replace('/', '-')
    state_lga_list = tracking_data[lga].unique().tolist()
    target_lga_list = process_delimited_input(lois)

    if target_lga_list:
        state_lga_list = filter_target(target_lga_list, state_lga_list)
        tracking_data = tracking_data.loc[tracking_data[lga].isin(state_lga_list)]

    post_implementation_report = PostImplementationReport(tracking_data, Reporters(cumulative=report_col), lga, ward)
    post_report = post_implementation_report.generate_report()
    zip_buffer = write_in_memory_zip(post_implementation_report, post_report, state_lga_list)

    return StreamingResponse(
        zip_buffer,
        media_type='application/zip',
        headers={'Content-Disposition': 'attachment; filename="post_implementation_reports.zip"'}
    )
