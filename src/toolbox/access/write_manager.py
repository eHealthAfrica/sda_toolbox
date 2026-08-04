import logging
from typing import Literal

import pandas as pd
import geopandas as gpd

from toolbox.access import Writer, CSVWriter, GeoWriter


def save_file(data: pd.DataFrame | gpd.GeoDataFrame, save_path: str, stype: Literal['csv', 'shp'], save_name: str=None):
    logging.info(f'Exporting {stype} file')
    if stype == 'csv':
        exporter: Writer = CSVWriter(data, save_path)
    else:
        exporter = GeoWriter(GeoWriter, save_path)

    exporter.save_data(save_name)
    logging.info(f'File Saved Successfully to {save_path}')
    return