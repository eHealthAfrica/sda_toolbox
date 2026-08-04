import re
import logging

import numpy as np
import pandas as pd

from toolbox.configs import CONFIG
from toolbox.tools import find_column
from toolbox.exceptions import MissingConfiguration
from toolbox.mlos import get_admin_col, detect_unique_admin_field, construct_new_unique


def update_abbreviations(row: pd.Series, col: str):
    text = row.get(col)
    if pd.isna(text):
        return np.nan

    pattern_map: dict[str, str] = CONFIG.get('ABBREVS').get('SETTLEMENT')
    for abbrev, word in pattern_map.items():
        pattern = re.compile(rf"\b{abbrev}\b\.?", re.IGNORECASE)
        text = re.sub(pattern, word, text, re.IGNORECASE)

    return text


def standardize_value(value: str):
    try:
        if pd.isna(value):
            return np.nan

        text = str(value).strip().title()
        if text == "":
            return np.nan

        updated_text = re.sub(rf"{CONFIG['REGEX']['WHITE_SPACE']}", ' ', text, flags=re.ASCII)
        return updated_text
    except (TypeError, AttributeError):
        return value


def standardize_column_names(data: pd.DataFrame, columns: list=None) -> pd.DataFrame:
    try:
        if not columns:
            columns = data.columns

        logging.info(f'removing whitespaces from {len(columns)} columns')
        whitespace_pattern = CONFIG['REGEX']['WHITE_SPACE']
        # Use a dictionary {pattern: replacement}
        data[columns] = data[columns].replace(rf'{whitespace_pattern}', ' ', regex=True)
        col_map = {col: col.strip().replace(" ", "_").replace('\n', "").strip().lower() for col in columns}
        data.rename(columns=col_map, inplace=True)
        return data
    except KeyError as e:
        raise MissingConfiguration('config info missing', f'{e}')


def common_transformations(data: pd.DataFrame):
    exclusions = CONFIG['EXCLUSIONS']
    columns_to_exclude = [find_column(data, exc, 'ignore') for exc in exclusions]
    columns_to_standardize = [
        col for col in data.columns
        if col not in columns_to_exclude
        and data[col].dtype.name == 'str'
    ]

    logging.info('Standardizing Values')
    for col in columns_to_standardize:
        data[col] = data[col].apply(standardize_value)

    logging.info('Standardizing Column Names')
    data = standardize_column_names(data)

    logging.info('Updating Abbreviations')
    settlement = get_admin_col(data, 'settlement')
    data[settlement] = data.apply(update_abbreviations, args=(settlement, ), axis=1)
    unique_code = detect_unique_admin_field(data)

    if unique_code:
        print('Deleting Unique Code')
        data.drop(columns=unique_code, inplace=True)

    data = construct_new_unique(data, 'unique_code', settlement)

    return data
