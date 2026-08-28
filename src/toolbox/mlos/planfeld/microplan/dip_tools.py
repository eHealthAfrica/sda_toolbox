import re
from pathlib import Path
from dataclasses import dataclass

import pandas as pd

from toolbox.exceptions import DataError
from toolbox.mlos import get_admin_col
from toolbox.tools import find_column


@dataclass
class TemplateFields:
    state: str
    lga: str
    ward: str
    settlement: str
    takeoff: str
    category: str
    households: str
    team: str
    activity_days: str



def greater_than_10k(text: str):
    try:
        int_text = int(text)
        if int_text > 10000:
            return "Review"
        return None
    except (TypeError, ValueError):
        return None


def clean_team_code(value):
    if value is None:
        return None
    if isinstance(value, int):
        return str(int(value)).replace('.0','')
    # Ensure it's a string, then replace any of the 4 chars with ;
    return re.sub(r'[&,_/]', ';', str(value))


def clean_activity_days(value: str):
    if pd.isna(value):
        return None

    values = re.sub(r"Day ", "", value, re.IGNORECASE).strip()
    days = re.findall(r'\d', values)
    valid_days = [day for day in days if int(day) < 5]
    unique_days = set(map(int, valid_days))
    days_str = f"Day {', '.join(map(str, unique_days))}"
    return days_str


def split_record_to_rows(dataset: pd.DataFrame, record_col: str, team_delimiter: str=";") -> pd.DataFrame:
    dataset[record_col] = dataset[record_col].str.split(team_delimiter)
    exploded_dip = dataset.explode(record_col)
    exploded_dip[record_col] = exploded_dip[record_col].str.strip()
    return exploded_dip


def validate_team_codes(dataset: pd.DataFrame, team_code_col: str) -> pd.DataFrame:
    dataset['Team Code Review'] = dataset[team_code_col].apply(greater_than_10k)
    flagged_team_data = dataset.loc[dataset['Team Code Review'] == 'Review']
    if not flagged_team_data.empty:
        flagged_team_codes = flagged_team_data[team_code_col].unique().tolist()
        raise DataError(
            'Invalid Team Codes',
            f"The Following Team Codes are invalid {'\n'.join(flagged_team_codes)}"
        )

    dataset[team_code_col] = dataset[team_code_col].apply(clean_team_code)
    dataset.drop(columns=["Team Code Review"], inplace=True)
    return dataset


def find_day_of_activity_col(dataset: pd.DataFrame):
    cols = dataset.columns.tolist()
    searches = [re.search(r"^.*?\bDay\b.*$", col, re.IGNORECASE) for col in cols]
    if all(search is None for search in searches):
        raise DataError("Not Found", "No Column Matches Day of Activity")

    #Todo: Try an Approach that looks the text day in the string columns

    activity_day_col = [search.group(0) for search in searches if search is not None][0]
    return activity_day_col


def standardize_activity_days(dataset: pd.DataFrame, day_col: str=None) -> pd.DataFrame:
    activity_day_col = day_col if day_col else find_day_of_activity_col(dataset)
    dataset[activity_day_col] = dataset[activity_day_col].apply(clean_activity_days)
    return dataset


def prepare_dip_data(dataset: pd.DataFrame) -> tuple[pd.DataFrame, TemplateFields]:
    print("Finding Necessary Attribute Columns")
    state, lga, ward, settlement = [get_admin_col(dataset, admin) for admin in ['state', 'lga', 'ward', 'settlement']]
    team_col = find_column(dataset, 'Team')
    days_col = find_day_of_activity_col(dataset)
    dataset = dataset.loc[
        (dataset[days_col].notna()) |
        (dataset[team_col].notna())
        ]

    dataset = validate_team_codes(dataset, team_col)
    dataset = split_record_to_rows(dataset, team_col)
    dataset[team_col] = dataset[team_col].astype('string')
    dataset[team_col] = dataset[team_col].str.pad(3, 'left', '0')
    dataset['unique_team_code'] = dataset.apply(lambda row: f"{row[lga]}_{row[ward]}_{row[team_col]}", axis=1)

    dataset = standardize_activity_days(dataset, days_col)
    take_off_col = find_column(dataset, 'Take off', 'ignore')
    households = find_column(dataset, 'households', 'ignore')
    category_col = find_column(dataset, 'category', 'ignore')

    fields: TemplateFields = TemplateFields(
        state=state,
        lga=lga,
        ward=ward,
        settlement=settlement,
        takeoff=take_off_col,
        category=category_col,
        households=households,
        team=team_col,
        activity_days=days_col
    )

    return dataset, fields


def define_team_ranges(distribution_data: pd.DataFrame) -> pd.DataFrame:
    distribution_data.sort_values(by='Admin Code', inplace=True)
    distribution_data['Highest Team Code'] = distribution_data['H2H Teams'].cumsum()
    distribution_data['Lowest Team Code'] = distribution_data['Highest Team Code'] - distribution_data['H2H Teams'] + 1
    distribution_data['Team Allocation Range'] = distribution_data.apply(
        lambda row: f"{row['Lowest Team Code']} - {row['Highest Team Code']}", axis=1)

    return distribution_data


def line_list_issues(dataset: pd.DataFrame, review_column: str, fields: TemplateFields) -> str:
    issues_data = dataset.loc[dataset[review_column].notna()]
    issues_data["Msg"] = issues_data.apply(
        lambda row: f"Issues Encountered in {row[fields.ward]} ward, {row[fields.lga]} LGA issues {row[review_column]}",
        axis=1)

    issues_log = issues_data['Msg'].tolist()
    return "\n".join(issues_log)
