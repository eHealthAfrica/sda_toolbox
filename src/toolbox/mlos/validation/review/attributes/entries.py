import logging
from functools import partial
from typing import Any, Optional

import pandas as pd

from toolbox.tools import issues_counter
from toolbox.exceptions import MissingConfiguration
from toolbox.mlos import MLoSAttributes, Accessibility, PresetAttributes
from toolbox.mlos.validation.review.attributes.numeric import validate_numeric_columns


def validate_global_id(data: pd.DataFrame, global_id: str):
    logging.info('Checking Global ID column for empty and duplicate values')
    if global_id is None:
        data[f'WE_{global_id}'] = 'Global ID column not found'
        issues_counter(data, f'WE_{global_id}', 'EHA GUID', suffix=True)
        return data

    data.loc[data[global_id].isna(), [f'WE_{global_id}']] = 'No UUID'

    data.loc[
        (data.duplicated(subset=global_id, keep=False))
        & (data[f'WE_{global_id}'].isna()), [f'WE_{global_id}']
    ] = 'Duplicate UUID'

    issues_counter(data, f'WE_{global_id}', 'EHA GUID', suffix=True)
    return data


def validate_entries(options: list[str], value: Any):
    if pd.isna(value):
        return None

    if str(value) in options:
        return None

    return f'Invalid Entry'


def review_reason_for_inaccessibility(row: pd.Series, attributes: PresetAttributes):
    reason_for_inaccessibility = row[attributes.reasons_for_inaccessibility]
    if pd.notna(reason_for_inaccessibility):
        return None

    accessibility: str | None = row[attributes.accessibility_status]
    if pd.isna(accessibility):
        return None

    if Accessibility(accessibility.title()) != Accessibility.FULLY_ACCESSIBLE:
        return "Missing Reason for Inaccessibility Entry"

    return None


def validate_preset_columns(data: pd.DataFrame, cols: list[str] | dict, options: Optional[list] = None) -> pd.DataFrame:
    logging.info('Validating Columns with Preset Values')
    if isinstance(cols, list) and options is None:
        raise ValueError('missing parameter')

    for col in cols:
        logging.info(f'Reviewing {col}')
        if isinstance(cols, dict):
            options = cols[col]
        else:
            options = options

        col_values: list[Any] = data[col].tolist()
        partial_validator = partial(validate_entries, options)
        result_mapped = list(map(partial_validator, col_values))
        data.loc[:, [f"WE_{col}"]] = result_mapped

    return data


def validate_attributes_entry(dataset: pd.DataFrame, mlos_attributes: MLoSAttributes):
    try:
        dataset = validate_numeric_columns(dataset, mlos_attributes.numeric_attributes)

        y_n_cols = [col for col in mlos_attributes.y_n_attributes.__dict__.values()]
        dataset = validate_preset_columns(dataset, y_n_cols, ['Y', 'N'])
        _ = [issues_counter(dataset, col, supress=True, suffix=True) for col in [f'WE_{field}' for field in y_n_cols]]

        preset_validation_mapper = mlos_attributes.preset_attributes.preset_attribute_map()
        dataset = validate_preset_columns(dataset, preset_validation_mapper)
        dataset['WE_reasons_for_inaccessibility'] = dataset.apply(
            review_reason_for_inaccessibility, args=(mlos_attributes.preset_attributes,), axis=1)

        issues_counter(dataset, 'WE_reasons_for_inaccessibility')

        dataset = validate_global_id(dataset, mlos_attributes.global_id)

        return dataset
    except KeyError as e:
        raise MissingConfiguration('missing config info', f'{e}')
