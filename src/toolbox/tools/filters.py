import re
import zipfile
import logging
from pathlib import Path
from typing import Literal, Iterable, Optional

import numpy as np
import pandas as pd
from fuzzywuzzy import process

from toolbox.configs import CONFIG
from toolbox.exceptions import NotFoundError, MissingConfiguration


def filter_by_length(data: str, length: int) -> Literal['No', 'Yes']:
    if len(data) < length:
        return 'No'
    
    return 'Yes'


def detect_number(text: str):
    match = re.search(rf'{CONFIG.get("REGEX").get("NUM_PATTERN")}', text, re.IGNORECASE)
    return int(match.group()) if match else None


def remove_empty_elements(items: Iterable) -> list:
    return [item for item in items if item]


def select_highest(data: list[tuple[str, float]]) -> str:
    return max(data, key=lambda x: x[1])[0]


def reduce_items(all_items: list, found_item: list) -> list:
    return [item for item in all_items if item not in found_item]


def remove_empty_records(data: pd.DataFrame, cols: list[str]) -> list[str]:
    """Retrieves list of columns which do not have missing values"""
    return [col for col in cols if not pd.isna(data[col]).any()]


def issues_counter(data: pd.DataFrame, reference_col: str, title: str=None, supress: bool=False, suffix: bool=False):
    found_issues = data.loc[data[reference_col].notna()]
    issues_count = len(found_issues)
    title_reference = title if title else reference_col
    suffix_text = " Issues" if suffix else ""
    title = title_reference.replace("WE", "").replace('_', ' ').title()
    message = f'Settlements with {title}{suffix_text}'
    if not supress:
        print(f'{message}: {issues_count:,}')

    elif supress and issues_count == 0:
        ...

    else:
        print(f'{message}: {issues_count:,}')


def sort_matches(data: list[Iterable], idx: int):
    return sorted(data, key=lambda item: item[idx], reverse=True)


def find_column(data: pd.DataFrame, col_name: str, error: Literal['ignore', 'raise']='raise'):
    columns: list[str] = [col for col in data.columns]
    try:
        threshold: int = CONFIG['THRESHOLDS']['OVERALL']
    except KeyError as e:
        raise MissingConfiguration('Missing config info', f'{e}')

    matches: list[tuple[str, float]] | tuple[str, float] = process.extractBests(col_name, columns, score_cutoff=90)

    if len(matches) < 1 and error == 'raise':
        raise NotFoundError('Missing column', f"{col_name} not found in MLoS data")

    if len(matches) < 1 and error == 'ignore':
        data.insert(loc=len(columns), column=col_name, value=np.nan)
        return None

    if isinstance(matches, tuple):
        return matches[0]

    sorted_data = sort_matches(matches, 1)
    found_columns = [found[0] for found in sorted_data]
    return found_columns[0]


def get_unique_values(data: pd.DataFrame, unique_col: str) -> list:
    return data[unique_col].tolist()


def extract_and_find_file(zip_path: str, temp_dir: str, extension) -> str | list[str] | None:
    f"""Extract zip and find file of type {extension} (runs in thread pool)"""
    logging.info(f'Uncompressing and Checking for {extension} files')
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(temp_dir)

    found_files = [str(path) for path in Path(temp_dir).rglob(f"*.{extension}")]
    if len(found_files) >= 1:
        return found_files

    return None


def filter_coordinate_column(data: pd.DataFrame, col_list: Optional[list[str]]):
    if not col_list:
        col_list = [col for col in data.columns if data[col].dtype.name.__contains__('float')]

    coord_pattern = CONFIG['REGEX']['COORD_PATTERN']

    def matches_pattern(values: list):
        return any([re.match(rf"{coord_pattern}", str(value)) for value in values if pd.notna(value)])

    matching = {col: matches_pattern(data[col].tolist()) for col in col_list}
    matched = list(filter(lambda item: item[1], matching.items()))
    if len(matched) == 1:
        return matched[0][0]

    return [field[0] for field in matched]
