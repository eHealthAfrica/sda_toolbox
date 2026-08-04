from typing import Literal

import pandas as pd

from toolbox.spatial_mgr.geo_accessor import GeomColumns
from toolbox.access.read_mgr import read_dataset
from toolbox.campaign.campaign_tools import detect_unique_admin_field
from toolbox.tools import get_unique_values


def get_unique_list(data: pd.DataFrame | list, unique_col: str, method: Literal['direct', 'reduce']):
    if isinstance(data, pd.DataFrame):
        return get_unique_values(data, unique_col)
    elif isinstance(data, list):
        return data
    else:
        raise NotImplementedError(f'Parsing for {type(data)} not implemented')
        


def main(campaign_file: str, master_file: str):
    campaign_data: pd.DataFrame = read_dataset(campaign_file, False)
    master_data: pd.DataFrame = read_dataset(master_file, False)

    mlos_geo_columns: GeomColumns = GeomColumns.get_geom_cols(master_data, True)
    iev_geo = GeomColumns.get_geom_cols(campaign_data, False)

    mlos_col = detect_unique_admin_field(master_data)
    iev_col = detect_unique_admin_field(campaign_data)
