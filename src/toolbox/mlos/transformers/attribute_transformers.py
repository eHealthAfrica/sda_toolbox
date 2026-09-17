import numpy as np
import pandas as pd
from tqdm import tqdm
from fuzzywuzzy import process, fuzz

from toolbox.mlos.attribute_models import PresetAttributes

OTHER_DELIMITERS = [',', '-', 'and', '&']


def standard_preset_values(value: str, preset_values: list):
    if pd.isna(value):
        return np.nan

    if str(value) in preset_values:
        return value

    match: list[tuple[str, int]] = process.extractBests(value, preset_values, limit=5, scorer=fuzz.partial_ratio)

    if not match:
        matched_value = value
        return matched_value

    matched_value = max(match, key=lambda x: x[1])
    return matched_value[0]


def transform_preset_attributes(mlos_data: pd.DataFrame, preset_attributes: PresetAttributes) -> pd.DataFrame:
    """
    Enforce consistency of preset attributes for Accessibility Status, Reason for Inaccessibility, Habitation Status
    and Day of activity. Addresses spelling issues for these preset values.

    Parameters
    ----------
    mlos_data: pd.DataFrame MLoS DataFrame
    preset_attributes: PresetAttributes Columns object of MLoS data which have a preset values

    Returns
    -------
        pd.DataFrame updated MLoS Dataset
    """

    preset_map: dict[str, list[str]] = preset_attributes.preset_attribute_map()

    delimiter_map = {rf"\s*(?:{'|'.join(OTHER_DELIMITERS)})\s*": '_'}
    mlos_data[preset_attributes.day_of_activity] = mlos_data[preset_attributes.day_of_activity].astype(str)
    mlos_data[preset_attributes.day_of_activity] = mlos_data[preset_attributes.day_of_activity].str.lower()
    mlos_data[preset_attributes.day_of_activity] = mlos_data[preset_attributes.day_of_activity].replace(
        delimiter_map, regex=True
    )

    for field, preset_values in tqdm(preset_map.items(), desc='transforming'):
        mlos_data[f"{field}"] = mlos_data[field].apply(standard_preset_values, args=(preset_values,))

    return mlos_data
