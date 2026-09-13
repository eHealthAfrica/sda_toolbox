import tempfile

import pandas as pd
from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.tools import read_compiled_data
from toolbox.tracks_manager.tr import read_tracks
from toolbox.access.read_mgr import read_dataset
from toolbox.mlos.validation.review.spatial.coordinate_reviewer import review_settlement_coordinates

router = APIRouter()


@router.post("/coordinate_review", tags=["MLoS"])
async def settlements_coordinate_review(
        settlements_file: UploadFile, sources: UploadFile, tracks_data: UploadFile, use_osm: bool) -> FileResponse:
    """Triangulates and Evaluates Settlement Coordinates against Multiple Sources. Uses Similarity Check to find settlements
    To find settlements in other sources and calculates the distance between these sources as well checks whether
    these source settlements falls within GRID3 extent and is around GTS tracks

    Args:

    settlements_file: Path to the settlements file

    tracks_data: Path to the tracks data

    source: Excel File path with each sheet corresponding to the other sources

    use_osm: Set to True to include OSM data in Review

    Returns:
        Reviewed Dataset Output
    """
    settlements = await read_dataset(settlements_file)
    sources_dataset = await read_compiled_data(sources)
    tracks = await read_tracks(tracks_data)

    reviewed_data: pd.DataFrame = await review_settlement_coordinates(sources_dataset, settlements, tracks, use_osm)

    tmp_file = tempfile.NamedTemporaryFile(delete=False)
    reviewed_data.to_csv(tmp_file.name, index=False)

    return FileResponse(
        tmp_file.name,
        filename=tmp_file.name,
        media_type='text/csv',
    )