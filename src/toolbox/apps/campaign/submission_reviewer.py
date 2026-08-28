import tempfile

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse

from toolbox.campaign.submission_reviewer import review_submission
from toolbox.access.read_mgr import read_dataset
from toolbox.exceptions import NoRecordsFound
from toolbox.tools import generate_output_name
from toolbox.models import State

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
    reviewed_dataset = review_submission(dataset, state)

    if reviewed_dataset.empty:
        raise NoRecordsFound("Empty Dataset", "No Records Passed QC")

    tmp_file = tempfile.NamedTemporaryFile(delete=False)
    reviewed_dataset.to_csv(tmp_file.name, index=False)

    save_name = generate_output_name(data.filename, 'csv', 'reviewed')

    tmp_file.close()
    return FileResponse(
        tmp_file.name,
        media_type='text/csv',
        filename=save_name
    )
