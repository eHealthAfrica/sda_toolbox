import logging

import pandas as pd

from toolbox.tools import is_empty
from toolbox.mlos.attribute_models import NumericAttributes
from toolbox.mlos.validation.review.attributes.numeric import validate_numeric_attribute_consistency


def update_set_population(row: pd.Series, numeric_cols: NumericAttributes) -> float:
    settlement_pop = row[numeric_cols.set_population]
    settlement_target = row[numeric_cols.set_target]

    if pd.isna(row['WE_population']):
        return settlement_pop

    if is_empty(settlement_pop) and not is_empty(settlement_target):
        updated_pop = round(settlement_target / 0.2, 0)
        return updated_pop

    if settlement_target > 0.4 * settlement_pop:
        updated_pop = round(settlement_target / 0.2, 2)
        return updated_pop

    return settlement_pop


def update_target_population(row: pd.Series, numeric_cols: NumericAttributes) -> float:
    settlement_pop = row[numeric_cols.set_population]
    settlement_target = row[numeric_cols.set_target]

    if pd.isna(row['WE_population']):
        return settlement_target

    if not is_empty(settlement_pop) and is_empty(settlement_target):
        updated_target = int(settlement_pop * 0.2)
        return updated_target

    return settlement_target


def update_no_of_household(row: pd.Series, numeric_cols: NumericAttributes, issue: str|None):
    issue: str | None = row[issue]
    household: int|None = row[numeric_cols.number_of_household]
    if pd.isna(issue):
        return household

    target_pop: int|None = row[numeric_cols.set_target]
    if target_pop >= 8:
        return round(target_pop/8,0)

    total_pop = row[numeric_cols.set_population]
    return round(total_pop/10, 0)


def recalculate_population_entries(mlos_data: pd.DataFrame, numeric_attributes: NumericAttributes) -> pd.DataFrame:
    """
    Recalculates Settlement population and target values for settlements that have invalid entries

    Parameters
    ----------
    mlos_data: MLoS Dataset
    numeric_attributes: the numeric attribute columns object of the MLoS dataset

    Returns
    -------
        pd.DataFrame: Transformed MLoS dataset with corrected and standardized population values.
    """
    logging.info('Reviewing Settlement and Target Population Data')
    mlos_data = validate_numeric_attribute_consistency(mlos_data, numeric_attributes)

    if pd.notna(mlos_data['WE_population']).any():

        print('Fixing Population Errors...')
        logging.info('Fixing Settlement Population Entries')
        mlos_data[numeric_attributes.set_population] = mlos_data.apply(
            update_set_population, args=(numeric_attributes,), axis=1)

        logging.info('Fixing Target Population Entries')
        mlos_data[numeric_attributes.set_target] = mlos_data.apply(
                update_target_population, args=(numeric_attributes,), axis=1)

    if pd.notna(mlos_data['WE_household']).any():
        print('Fixing Household Entries')
        mlos_data[numeric_attributes.number_of_household] = mlos_data.apply(
            update_no_of_household, args=(numeric_attributes, 'WE_household'), axis=1)


    mlos_data.drop(columns=['WE_population', 'WE_household'], inplace=True)
    return mlos_data
