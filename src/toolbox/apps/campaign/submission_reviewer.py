from fastapi import APIRouter, UploadFile, File, Form

from toolbox.campaign.submission_reviewer import review_submission
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import NoRecordsFound
from toolbox.tools import generate_output_name
from toolbox.models import State
from toolbox.utils.offload import run_heavy
from toolbox.utils.tempfiles import afile_response

router = APIRouter()


@router.post("/submission_reviewer", tags=["Campaign"])
async def campaign_submissions_reviewer(data: UploadFile = File(...), state: State=Form(None)):
    """
    Review a campaign submission dataset to ensure that the submissions are consistent with the reported LGA and Ward

    Parameters
    ----------
    data : UploadFile
        The dataset to be reviewed

    state: State
        The current state of the campaign

    Raises
    ------
        NoRecordsFound if no records passed the review process

    Returns
    -------
        CSV File of Reviewed Dataset
    """
    dataset = await read_dataset(data)
    reviewed_dataset = await run_heavy(review_submission, dataset, state)

    if reviewed_dataset.empty:
        raise NoRecordsFound("Empty Dataset", "No Records Passed QC")

    save_name = generate_output_name(data.filename, 'csv', 'reviewed')
    return await afile_response(lambda path: reviewed_dataset.to_csv(path, index=False), '.csv', 'text/csv', save_name)
