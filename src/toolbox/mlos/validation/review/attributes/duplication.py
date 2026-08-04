from typing import Optional
from functools import partial

import numpy as np
import pandas as pd

from toolbox.exceptions import InvalidInputError
from toolbox.mlos import get_admin_col
from toolbox.tools import issues_counter
from toolbox.spatial_mgr import GeomColumns


def find_empty_and_duplicates(
        data: pd.DataFrame, columns: str | list, output_col: Optional[str] = None, ignore_na: bool = False):
    # Todo: Simplify Function ignore_na should be a standard action
    """Find Empty and Duplicate Rows in a DataFrame"""
    if isinstance(columns, list) and not output_col:
        raise InvalidInputError('argument missing', 'output column required for iterable columns')

    output_col = output_col if output_col else f"WE_{columns}"
    issue_title = output_col.replace("WE", "").replace("_", " ").title()

    data.loc[data.duplicated(subset=columns, keep=False), [output_col]] = output_col
    if not ignore_na:
        issues_counter(data, output_col, issue_title)
        return data

    if isinstance(columns, str):
        query = f"{columns}.notnull()"
    else:
        mapped_columns = [f"{col}.notnull()" for col in columns]
        query = ' & '.join(mapped_columns)
        query += f" & {output_col}.notnull()"

    data = data.eval(f"{output_col}={query}")
    data[output_col] = data[output_col].replace({True: output_col, False: np.nan}, regex=False)

    non_empty_duplicates = list(filter(lambda row: pd.notna(row), data[output_col]))
    print(f"Settlements with {issue_title}: {len(non_empty_duplicates)}")
    return data

def validate_settlement_name_length(settlement_name: str) -> str | None:
    if pd.isna(settlement_name):
        return "no settlement name"

    settlement_name = settlement_name.strip()
    if len(settlement_name) < 3:
        return "invalid name length"

    settlement_name_elements = settlement_name.split(" ")
    if len(settlement_name_elements)>=10:
        return "review settlement name"

    return None


def find_duplicate_attributes(mlos_data: pd.DataFrame, geo_columns: GeomColumns, unique_col: str) -> pd.DataFrame:
    """Find Direct Duplicate settlements and geometry in the dataset"""
    # Todo: Convert Admin Columns to Title Case
    admin_checker = partial(get_admin_col, mlos_data)
    settlement_col = admin_checker('settlement')
    mlos_data['invalid_name_length'] = mlos_data.apply(
        lambda row: validate_settlement_name_length(row[settlement_col]),
        axis=1)

    issues_counter(mlos_data, 'invalid_name_length')

    mlos_data = find_empty_and_duplicates(
        mlos_data,
        [geo_columns.latitude, geo_columns.longitude],
        'stacked_point',
        True
    )

    mlos_data = find_empty_and_duplicates(
        mlos_data, unique_col,
        'duplicate_attribute',
        False)

    return mlos_data
