from typing import Literal, Sized
from pathlib import Path
import logging
import os

import geopandas as gpd
import pandas as pd

from toolbox import CPU_COUNT
from toolbox.utils import timer, logger
from toolbox.access.read_mgr import read_dataset, read_batch_data
from toolbox.tools.chunks_manager import create_chunks

logger(log_name='Tracks Manager')


def profile_size(data: Sized):
    if len(data) > 1000:
        return None

    if len(data) < CPU_COUNT * 2:
        return len(data)

    return CPU_COUNT - 2


def get_tracks_file(tracks_path: str, extension: str) -> str | list[str]:
    logging.info('Reading tracks data')

    if os.path.isfile(tracks_path):
        return tracks_path

    if os.path.isdir(tracks_path) and not extension:
        logging.error('No Extension provided for batch file reading')
        raise ValueError('Please Provide an Extension for tracks file')

    track_files = [str(file) for file in Path(tracks_path).rglob(f'*{extension}')]
    if not track_files:
        logging.error(f'No {extension} Files were found')
        raise FileNotFoundError(f'No {extension} Files were found')

    return track_files


def read_tracks(tracks_path: str | list[str]) -> gpd.GeoDataFrame:
    """
    Reads tracks data either as a single file or as a collection from a directory

    :param tracks_path: Single file or directory containing tracks data
    :return: Combined tracks data as a GeoDataFrame
    """
    logging.info('Reading tracks data')

    if isinstance(tracks_path, str):
        return read_dataset(tracks_path)

    tracks_datasets: list[gpd.GeoDataFrame] = []
    chunk_size = profile_size(tracks_path)
    track_chunks = create_chunks(tracks_path, chunk_size)
    for chunk in track_chunks:
        tracks_data: gpd.GeoDataFrame =  read_batch_data(chunk, True)
        tracks_datasets.append(tracks_data)

    compiled_tracks = pd.concat(tracks_datasets)
    return compiled_tracks


@timer
def read_and_combine_tracks(tracks_path: str, tracks_extension: Literal['csv', 'shp', 'kml']):
    tracks_file = get_tracks_file(tracks_path, tracks_extension)
    tracks = read_tracks(tracks_file)
    tracks.drop(columns='geometry', inplace=True)
    tracks.csv("tracks_data.csv", index=False)


if __name__ == '__main__':
    read_and_combine_tracks("C:\\WORKSPACE\\OBR\\JUNE_2025_NIPDS\\X", 'csv')
