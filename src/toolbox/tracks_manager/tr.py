import logging
import tempfile
from typing import Any

import pandas as pd
import geopandas as gpd

from toolbox.utils import atimer
from toolbox.tracks_manager.preprocess import filter_valid_tracks
from toolbox.access.read_mgr import read_dataset, read_batch_data
from toolbox.exceptions import InvalidInputError, FileNotFound
from toolbox.tools import extract_and_find_file, save_uploaded_file, create_chunks


@atimer
@filter_valid_tracks(default_filter=True)
async def read_tracks(tracks_path: Any, tracks_extension: str=None, apply_filter: bool=True) -> gpd.GeoDataFrame:
    """
    Reads tracks data either as a single file or as a collection from a directory

    Parameters:
        tracks_path: Single file or directory containing tracks data
        tracks_extension: extension of the track data containing the track file
        apply_filter: Remove Invalid Tracks. Defaults to True

    Raises:
        InvalidInputError: If no extension is provided for batch file reading
        FileNotFound: If no files with the specified extension are found in the batch
        DataError: If the geometry column is missing when creating a GeoDataFrame

    Returns:
        gpd.GeoDataFrame: Tracks data as a GeoDataFrame

    """
    logging.info('Reading tracks data')

    if not tracks_path.filename.endswith('.zip'):
        tracks: gpd.GeoDataFrame = await read_dataset(tracks_path, True)
        return tracks

    if tracks_path.filename.endswith('zip') and not tracks_extension:
        logging.error('No Extension provided for batch file reading')
        raise InvalidInputError('No Extension Provided', 'Please Provide an Extension for tracks file')

    with tempfile.TemporaryDirectory() as temp_dir:
        print('Saving Input Tracks data to Temporary Directory...')
        zip_path = await save_uploaded_file(tracks_path, temp_dir)
        track_files = extract_and_find_file(zip_path, temp_dir, tracks_extension)

        if not track_files:
            logging.error(f'No {tracks_extension} Files were found')
            raise FileNotFound("Files not Found", f'No {tracks_extension} Files were found')

        file_chunks = create_chunks(track_files, 15)
        track_chunks: list[gpd.GeoDataFrame] = [await read_batch_data(chunk, True) for chunk in file_chunks]
        track_df = pd.concat(track_chunks, ignore_index=True)
        print(f"Total Tracks Count: {len(track_df):,}")
        tracks = gpd.GeoDataFrame(track_df)
        assert isinstance(tracks, gpd.GeoDataFrame)

        return tracks