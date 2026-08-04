import re
import pandas as pd

from toolbox.configs import CONFIG
from toolbox.tools import get_next_letter


def get_ward_code(row: pd.Series, ward_col: str, ward_code_col: str, ref_data: pd.DataFrame):
    ward_name = row[ward_col]
    code = ref_data.loc[ref_data[ward_col]==ward_name, ward_code_col].iloc[0]
    return int(code)


def has_suffix(codes: list[str]):
    matches =  [re.search(r'[A-Z]', code) for code in codes]
    if any(matches):
        suffixes = [suffix.group(0) for suffix in matches]
        return max(suffixes)

    return False


def generate_take_off_attributes(
        dataset: pd.DataFrame, identifier: str, take_off_point: str, ward:str, takeoff_code: str) -> pd.DataFrame:
    pending_dataset = dataset.loc[dataset[identifier].isna()]
    facilities = CONFIG['TAKE-OFF-POINTS']
    facilities_map = "|".join([f for f  in facilities])
    pattern = rf"\b({facilities_map})\b"
    pending_dataset['type']  = pending_dataset[take_off_point].str.extract(pattern, expand=False)
    pending_dataset['type_code'] = pending_dataset['type'].map(facilities.get)
    dataset = dataset[~dataset.index.isin(pending_dataset.index.tolist())]
    pending_dataset[identifier] = pending_dataset.apply(get_ward_code, args=(ward, identifier, dataset), axis=1)
    pending_dataset[takeoff_code] = pending_dataset.apply(lambda row: f"{row[identifier]}/{row['type_code']}", axis=1)
    pending_dataset.drop(columns=['type', 'type_code'], inplace=True)
    dataset = review_takeoff_duplication(pending_dataset, takeoff_code, dataset)
    return dataset


def review_takeoff_duplication(takeoff_data: pd.DataFrame, take_off_code: str, reference_data:pd.DataFrame):
    reviewed = pd.DataFrame()
    takeoff_group = takeoff_data.groupby(by=take_off_code)
    for takeoff_code, takeoff in takeoff_group:
        exists = reference_data.loc[reference_data[take_off_code].str.match(takeoff_code)]
        if exists.empty:
            pass
        else:
            suffix = has_suffix(exists[take_off_code].tolist())
            if not suffix:
                reference_data.loc[reference_data[take_off_code]==takeoff_code, [take_off_code]]=f"{takeoff_code}A"
                takeoff.loc[:, [take_off_code]] = f"{takeoff_code}B"
            else:
                new_suffix = get_next_letter(suffix)
                takeoff.loc[:, [take_off_code]] = f"{takeoff_code}{new_suffix}"
                pass

        reviewed = pd.concat([reviewed, takeoff])

    return pd.concat([reference_data, reviewed]).sort_values(by=take_off_code)