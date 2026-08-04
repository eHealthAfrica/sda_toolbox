import logging
from typing import Any
import concurrent.futures

import openpyxl
import pandas as pd
from tqdm import tqdm
import geopandas as gpd

from toolbox import CPU_COUNT
from toolbox.utils import atimer
from toolbox.access import ReadGeoData, ReadTableData
from toolbox.exceptions import NotSupportedError, DataError


def prepare_and_create_gdf(dataset: pd.DataFrame | gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    logging.info('Converting Merged Datasets to GeoDataFrame...')
    if isinstance(dataset, gpd.GeoDataFrame):
        print(f'Final Tracks Record Count: {len(dataset):,}')
        return dataset

    if 'geometry' not in dataset.columns:
        raise DataError('geometry not found', 'no geometry column found cannot create GeoDataFrame')

    gdf = gpd.GeoDataFrame(dataset, geometry='geometry')
    print(f'Record Count: {len(gdf):,}')
    return gdf


async def read_dataset(input_file: Any, is_spatial: bool = False, sheet: str=None):
    if hasattr(input_file, 'filename') and hasattr(input_file, 'file'):
        extension = input_file.filename.split('.')[-1]

    else:
        extension = input_file.split('.')[-1]

    if extension in ['csv', 'xls', 'xlsx']:
        result = await ReadTableData(input_file, is_spatial).read_data(sheet)
        return result

    if extension in ['shp', 'kml', 'sqlite', 'zip', 'gpkg']:
        result: gpd.GeoDataFrame = await ReadGeoData(input_file, sheet).read_data()
        return result

    logging.error('File format not yet supported')
    raise NotSupportedError("Not Supported", f'File format {extension} is not yet supported')


@atimer
async def read_batch_data(files_path: list[str], is_spatial: bool) -> pd.DataFrame | gpd.GeoDataFrame:
    """
    Read multiple track files using Multiprocessing protocols

    :param files_path: Path list of the data to read
    :param is_spatial: indicates whether the file must have latitude and longitude
    :return: Single DataFrame of the read-in data files
    """
    logging.info(f'Batch Reading {len(files_path)} Files')
    print(f'Reading {len(files_path)} Files')

    dataframes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CPU_COUNT) as executor:
        futures = [executor.submit(read_dataset, file, is_spatial) for file in files_path]

        for future in tqdm(concurrent.futures.as_completed(futures), desc='reading datasets', total=len(files_path)):
            data = await future.result()
            dataframes.append(data)

    logging.info('Merging tracks dataset...')
    df = pd.concat(dataframes, ignore_index=True)

    if not is_spatial:
        return df

    return prepare_and_create_gdf(df)


async def read_workbook(excel_workbook: str):
    ...


def get_excel_sheet_names(file_paths: str | list[str]):
    if isinstance(file_paths, str):
        file_paths = [file_paths]

    excel_map: dict[str, list[str]] = {
        lga_file: openpyxl.load_workbook(lga_file).sheetnames
        for lga_file in file_paths
    }

    return excel_map
