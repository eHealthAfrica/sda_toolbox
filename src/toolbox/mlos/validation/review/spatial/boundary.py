import logging
from functools import partial

import pandas as pd
import geopandas as gpd
from fuzzywuzzy import fuzz

from toolbox.exceptions import MissingConfiguration
from toolbox.mlos import get_admin_col, AdminColumns
from toolbox.tools import issues_counter
from toolbox.access import ReadDBData
from toolbox.configs import CONFIG
from toolbox.models import State


def review_admin_columns(mlos_admin: AdminColumns, boundary_admin: AdminColumns) -> tuple[AdminColumns, ...]:
    if mlos_admin.state == boundary_admin.state:
        mlos_admin.state = f"{mlos_admin.state}_left"
        boundary_admin.state = f"{boundary_admin.state}_right"

    if mlos_admin.lga == boundary_admin.lga:
        mlos_admin.lga = f"{mlos_admin.lga}_left"
        boundary_admin.lga = f"{boundary_admin.lga}_right"

    if mlos_admin.ward == boundary_admin.ward:
        mlos_admin.ward = f"{mlos_admin.ward}_left"
        boundary_admin.ward = f"{boundary_admin.ward}_right"

    return mlos_admin, boundary_admin


def check_admin(row: pd.Series, data_admin: AdminColumns, boundary_admin: AdminColumns):
    state_value: str = row[data_admin.state]
    boundary_state_value: str = row[boundary_admin.state]
    if pd.isna(boundary_state_value) and pd.isna([row['latitude'], row['longitude']]).any():
        return None

    if pd.isna(boundary_state_value) or pd.isna(state_value):
        return "Outside State"

    if fuzz.partial_ratio(state_value.lower(), boundary_state_value.lower()) <97:
        return "Outside State"

    lga_value: str = row[data_admin.lga]
    boundary_lga_value: str = row[boundary_admin.lga]
    if pd.isna(lga_value) or pd.isna(boundary_lga_value):
        return "Outside LGA"

    if fuzz.token_set_ratio(lga_value.lower(), boundary_lga_value.lower()) <97:
        return "Outside LGA"

    ward_value: str = row[data_admin.ward]
    boundary_ward_value: str = row[boundary_admin.ward]
    if pd.isna(ward_value) or pd.isna(boundary_ward_value):
        return "Outside Ward"

    if fuzz.token_set_ratio(ward_value.lower(), boundary_ward_value.lower()) <97:
        return "Outside Ward"

    return None


def administrative_info_checks(dataset: gpd.GeoDataFrame):
    try:
        logging.info('Checking for Boundary issues')
        data_admin = AdminColumns.create_by_search(dataset)

        states: list[str] = dataset[data_admin.state].str.title().str.strip().unique().tolist()
        boundary_data: gpd.GeoDataFrame = ReadDBData(
            CONFIG["DATASETS"]["ward_boundary"], True).read_data({"statename": states})

        boundary_admin: AdminColumns = AdminColumns('statename', 'lganame', 'wardname')
        joined: gpd.GeoDataFrame = dataset.sjoin(
            boundary_data[[boundary_admin.state, boundary_admin.lga, boundary_admin.ward, 'geometry']],
            how='left',
            predicate='intersects'
        )

        data_admin, boundary_admin = review_admin_columns(data_admin, boundary_admin)
        joined['boundary_issues'] = joined.apply(check_admin, args=(data_admin, boundary_admin), axis=1)
        issues_counter(joined, 'boundary_issues')

        joined.drop(
            columns=[boundary_admin.state, boundary_admin.lga, boundary_admin.ward, "index_right"],
            inplace=True
        )

        return joined

    except KeyError as e:
        raise MissingConfiguration('Missing Config info', f'{e}')
