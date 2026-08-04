import re
import logging
from typing import Any

import pandas as pd

from toolbox.configs import CONFIG
from toolbox.mlos import NumericAttributes
from toolbox.tools import issues_counter, is_empty
from toolbox.exceptions import MissingConfiguration


def is_numeric(value: Any, allow_zero: bool) -> str | None:
    try:
        if pd.isna(value):
            return None

        if allow_zero:
            return None

        if (isinstance(value, float) or isinstance(value, int)) and (value!=0):
            return None

        test = re.match(rf'{CONFIG["REGEX"]["NUM_PATTERN"]}', str(value), re.ASCII)
        if not test:
            return "Wrong Entry"

        return None
    except KeyError as e:
        raise MissingConfiguration(msg='Configuration missing', details=f'Error Message: {e}')


def validate_numeric_columns(data: pd.DataFrame, numeric_attributes: NumericAttributes) -> pd.DataFrame:
    logging.info('Validating Numeric Column Values')

    allow_zero_map = numeric_attributes.allow_zero()
    for col in numeric_attributes.__dict__.values():
        allow_zero = allow_zero_map.get(col)
        data[f"WE_{col}"] = data.apply(lambda row: is_numeric(row[col], allow_zero), axis=1)
        issues_counter(data, f"WE_{col}", supress=True, suffix=True)

    data = validate_numeric_attribute_consistency(data, numeric_attributes)

    return data


def populations_consistency_check(total_population: int, target_population: int) -> None | str:
    if pd.isna([total_population, target_population]).all():
        return None

    if total_population == 0 and target_population == 0:
        return None

    if not pd.notna([total_population, target_population]).all():
        return "Missing total/target Population Entry"

    if target_population >= total_population:
        return "Invalid Population Entry"

    return None


def household_consistency_check(household: int, target_pop: int, total_pop: int):
    empty_household = is_empty(household)

    if pd.isna([household, target_pop, total_pop]).all():
        return None

    if total_pop == target_pop == household == 0:
        return None

    if pd.notna([target_pop, total_pop]).any() and empty_household:
        return 'Missing Settlement Household'

    target_ratio = round(target_pop / household, 0)
    if target_ratio > 15:
        return  f"{int(target_ratio)} children per household should be reviewed"

    pop_ratio = round(total_pop / household, 0)
    if pop_ratio > 40:
        return  f"{int(pop_ratio)} people per household should be reviewed"

    return None


def validate_numeric_attribute_consistency(dataset: pd.DataFrame, num_attr: NumericAttributes):
    dataset['WE_population'] = dataset.apply(
        lambda row: populations_consistency_check(row[num_attr.set_population], row[num_attr.set_target]), axis = 1)

    issues_counter(dataset, 'WE_population', 'Population consistency', suffix=True)
    dataset['WE_household'] = dataset.apply(
        lambda row: household_consistency_check(
            row[num_attr.number_of_household], row[num_attr.set_target], row[num_attr.set_population]), axis=1
    )

    issues_counter(dataset, 'WE_household', 'Household consistency', suffix=True)

    return dataset
