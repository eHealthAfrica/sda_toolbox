import io
import logging
from pathlib import Path
from datetime import datetime
from typing import Any, Optional

import geopandas as gpd
from fastapi.responses import StreamingResponse
from fastapi import APIRouter, BackgroundTasks, UploadFile, Query

from toolbox.utils import atimer
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.spatial_mgr import SpatialOps
from toolbox.models import State, Extensions
from toolbox.tracks_manager.tr import read_tracks
from toolbox.exceptions import DataError, NoRecordsFound


router = APIRouter()

from dataclasses import dataclass

@dataclass
class Export:
    temporary_file: Path
    temporary_dir : Optional[Path] = None


def cleanup_files(temp_dir_object: Any):
    """
    Cleanup temporary directory using the TemporaryDirectory object's own cleanup method.
    This ensures the directory is removed when the background task executes.
    """
    try:
        temp_dir_path = Path(temp_dir_object.name)
        temp_dir_object.cleanup()
        logging.info(f"Successfully cleaned up directory: {temp_dir_path}")
    except Exception as e:
        logging.warning(f"Error cleaning up temporary directory {temp_dir_object.name}: {e}")



@atimer(title="Combine Tracks")
@router.post('/compiler/tracks', tags=['Compiler'])
async def combine_tracks(
        tracks_path: UploadFile , tracks_extension: Extensions,
        background_tasks: BackgroundTasks, states: list[State] | None = Query(default_factory=None), remove_invalid_tracks: bool=True): # noqa
    """
    Reads and Combines individual track files in a directory into a single dataset.

    Parameters
    ------------
    tracks_path: UploadFile
        Zipped location of tracks data <br>
    tracks_extension: Extensions
        extension of the track files<br>
    state: State <br>
        AOI of tracks. Provide state to clip combined tracks to AOI. Defaults to None to retrieve all tracks<br>
    remove_invalid_tracks: bool
        Specify whether to remove invalid tracks (speed > 1 m/s). Default is True

    Returns
    --------
        FileResponse: Downloadable zipped sqlite file of combined tracks data

    """

    temp_dir_obj = None # Initialize for potential cleanup in except block
    try:
        tracks: gpd.GeoDataFrame = await read_tracks(
            tracks_path,
            tracks_extension.value,
            apply_filter=remove_invalid_tracks
        )

        if states:
            state_names = [state.value for state in states]
            state_boundary_table = CONFIG['DATASETS']['state_boundary']
            state_boundary = ReadDBData(state_boundary_table, True).read_data({'statename': [state_names]})
            tracks = SpatialOps.clip_dataset(tracks, state_boundary)
            if tracks.empty:
                return NoRecordsFound('No Records', f'No Tracks Fall within {", ".join(state_names)}')

            tracks = tracks.sjoin(state_boundary[['geometry', 'statename']], how='left', predicate='intersects')
            print(f"Tracks Count Within {", ".join(state_names)}: {len(tracks):,}")

        print('Saving to GeoPackage Database...')
        buffer = io.BytesIO()
        tracks.to_file(buffer, driver="GPKG", layer='tracks', engine="pyogrio")
        buffer.seek(0)

        timestamp = datetime.now().strftime("%Y_%m_%d__%H_%M_%S")
        return StreamingResponse(
            buffer,
            media_type="application/geopackage+sqlite3",
            headers={"Content-Disposition": f"attachment; filename=compiled_tracks_{timestamp}.gpkg"}
        )

    except Exception as e:
        logging.info(DataError('error occurred', f"An error occurred in combine_tracks: {e}"))
        if temp_dir_obj:
            cleanup_files(temp_dir_obj)
        raise


# if __name__ == '__main__':
#     import asyncio
#     tracks_file = UploadFile(r"C:\Users\enyinnaya.nwaiwu\Downloads\export_906_2025-06-19_02-31-35 (1).zip").read()
#     asyncio.run(
#         combine_tracks(tracks_file,
#                        Extensions.CSV, BackgroundTasks(), State.Kebbi))