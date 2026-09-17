import re
import logging
from functools import partial
from dataclasses import dataclass
from typing import Literal, Optional

import numpy as np
import pandas as pd
import geopandas as gpd
from fuzzywuzzy import process, fuzz

from toolbox.exceptions import DataError
from toolbox.tools.checks import count_delimiter
from toolbox.tools.filters import remove_empty_records


@dataclass
class AdminColumns:
    state: str
    lga: str
    ward: str
    settlement: Optional[str] = None

    @classmethod
    def create_by_search(cls, settlements_data: pd.DataFrame) -> "AdminColumns":
        admin_map = {
            admin: get_admin_col(settlements_data, admin)
        for admin in ['state', 'lga', 'ward', 'settlement']

        }

        admin_cols = AdminColumns(**admin_map)
        return admin_cols


def detect_unique_admin_field(campaign_data: pd.DataFrame) -> str | None:
    """Detects the concatenated unique settlement name column in a dataset"""
    logging.info('Checking for Unique Admin Code field')
    string_cols = [col for col in campaign_data.columns if campaign_data[col].dtype.name == 'str']
    plausible_cols = remove_empty_records(campaign_data, string_cols)

    if not plausible_cols:
        logging.error(DataError("unique_code missing", 'No Viable columns meet the requirements for unique code'))
        return None

    for col in plausible_cols:
        check = all([x>=2 for x in  map(count_delimiter, campaign_data[col])])
        if not check:
            continue

        return col

    return None


def concat_columns(row: pd.Series, admin_col: AdminColumns) -> float | str:
    if any([pd.isna(row[col]) for col in [admin_col.state, admin_col.lga, admin_col.ward, admin_col.settlement]]):
        return np.nan

    state: str = row[admin_col.state].strip().title()
    lga: str = row[admin_col.lga].strip().title()
    ward: str = row[admin_col.ward].strip().title()
    settlement: str = row[admin_col.settlement].strip().title()

    return f"{state}_{lga}_{ward}_{settlement}"


def get_admin_col(data: pd.DataFrame, admin_type: Literal['state', 'lga', 'ward', 'settlement'],
                  error: Literal['ignore', 'raise']='raise') -> str | None:
    """Finds and Retrieves the administrative data type column"""
    logging.info(f'Searching for {admin_type} column')

    result: list[tuple[str, float]] =  process.extractBests(admin_type, data.columns, limit=5, score_cutoff=80)

    if not result and error == 'raise':
        logging.error(f'{admin_type} could not be detected')
        raise DataError('Missing Field', f'{admin_type} could not be detected')

    if not result and error == 'ignore':
        logging.error(f'{admin_type} Column Not Detected and Ignored')
        return None

    admin_names = [admin[0] for admin in result]
    for admin_name in admin_names:
        exclusion_pattern = "(?:code|old|id)"
        if re.search(rf"{exclusion_pattern}", admin_name, re.IGNORECASE):
            continue

        if fuzz.partial_ratio(admin_type, admin_name.lower()) < 90:
            continue

        return admin_name

    return None


def construct_new_unique(data: pd.DataFrame, unique_col: str, settlement_col: str=None) -> pd.DataFrame | gpd.GeoDataFrame:
    """Constructs a unique_settlement name column using state, LGA, Ward and Settlement information"""
    logging.info('Creating unique code column')
    partial_admin = partial(get_admin_col, data)
    state_col = partial_admin('state')
    lga_col = partial_admin('lga')
    ward_col = partial_admin('ward')
    settlement_col = settlement_col if settlement_col else partial_admin('settlement')
    admin_cols = AdminColumns(state=state_col, lga=lga_col, ward=ward_col, settlement=settlement_col)
    data.insert(0, unique_col, np.nan)
    data[unique_col] = data.apply(concat_columns, args=(admin_cols, ), axis=1)
    return data
