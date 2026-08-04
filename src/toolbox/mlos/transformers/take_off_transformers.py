import re

import pandas as pd
from fuzzywuzzy import process

from toolbox.configs import CONFIG
from toolbox.mlos import MLoSAttributes
from toolbox.tools import find_column


def standardize_takeoff_point_name(take_off_point: str, pattern):
    if pd.isna(take_off_point):
        return None

    match = re.search(rf'{pattern}', take_off_point,
                      re.IGNORECASE)
    if not match:
        return take_off_point

    text_length = len(take_off_point)
    match_text = match.group(0)
    _, end = match.span()

    if end == text_length:
        return take_off_point

    updated_take_off_point = take_off_point.replace(match_text, "").strip() + f" {match_text}"

    return updated_take_off_point


def capitalize_facility_type(take_off_point: str, pattern: str, facility_types: list):
    if pd.isna(take_off_point):
        return None

    match = re.search(pattern, take_off_point, re.IGNORECASE)
    if not match:
        return take_off_point

    result = process.extractOne(match.group(0), facility_types)
    if not result:
        return take_off_point

    updated_takeoff_point = take_off_point.replace(match.group(0), result[0])
    return updated_takeoff_point


def standardize_take_off_point(mlos_data: pd.DataFrame, attributes: MLoSAttributes):
    facilities_config: dict[str, str] = CONFIG['REMAPPERS']['TAKE-OFF-POINT']
    renamer = {value: keyword for keyword, value in facilities_config.items() if value is not None}
    take_off_col = find_column(mlos_data, attributes.take_off_point)
    mlos_data[take_off_col] = mlos_data[take_off_col].replace(renamer, regex=True)

    facility_types = [facility for facility in facilities_config]
    keyword_pattern = f"(?:{'|'.join(facility_types)})"
    prefix = CONFIG["REGEX"]["TAKEOFF_PREFIX"]
    suffix = CONFIG["REGEX"]["TAKEOFF_SUFFIX"]
    pattern = f"{prefix}{keyword_pattern}{suffix}"

    mlos_data[take_off_col] = mlos_data[take_off_col].apply(
        standardize_takeoff_point_name, args=(pattern,))

    mlos_data[take_off_col] = mlos_data[take_off_col].apply(
        capitalize_facility_type, args=(keyword_pattern, facility_types))

    return mlos_data


if __name__ == '__main__':
    bauchi_df = pd.read_csv(r"C:\Users\enyinnaya.nwaiwu\Downloads\Bauchi Take off _cordinates.csv")
    attributes: MLoSAttributes = MLoSAttributes()(bauchi_df, CONFIG.get('ATTRIBUTE_COLUMNS'), global_id='eha_guid')
    updated_df = standardize_take_off_point(bauchi_df, attributes)
    updated_df.to_csv("updated_bauchi_takeoff.csv", index=False)
