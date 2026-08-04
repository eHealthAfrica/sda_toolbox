import logging

import pandas as pd
from fuzzywuzzy import process

from toolbox.configs import CONFIG
from toolbox.mlos import MLoSAttributes
from toolbox.mlos.attribute_models import NumericAttributes, YNAttributes, PresetAttributes


def find_columns(source: list[str], data_columns: list[str]):
    remapped_columns = {}
    for col in source:
        if col in remapped_columns:
            continue

        result: tuple[str, float] = process.extractOne(col, data_columns, score_cutoff=95)
        if not result:
            continue

        remapped_columns[col] = result[0]

    return remapped_columns


def map_columns(columns: list):
    column_mapper = {}
    attributes_cols: dict[str, list[str]] = CONFIG.get('ATTRIBUTE_COLUMNS')
    for attribute in ['NUMERIC_COLUMNS', 'Y_N_COLUMNS', 'PRESET_COLUMNS']:
        attribute_name = attribute.lower().replace("columns", "attributes")
        column_mapper[attribute_name] = find_columns(attributes_cols.get(attribute), columns)

    return column_mapper


def build_attributes(dataset: pd.DataFrame) -> MLoSAttributes:
    """Builds parses and builds an attribute object from the MLoS data"""
    logging.info('Constructing Entry Attributes Object')
    attribute_data: dict[str, dict[str, str]] = map_columns(dataset.columns)

    mlos_attributes: MLoSAttributes = MLoSAttributes(
        numeric_attributes=NumericAttributes(**attribute_data.get('numeric_attributes')),
        y_n_attributes=YNAttributes(**attribute_data.get('y_n_attributes')),
        preset_attributes=PresetAttributes(**attribute_data.get('preset_attributes'))
    )

    return mlos_attributes
