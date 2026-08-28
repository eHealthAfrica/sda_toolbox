from itertools import chain
import concurrent.futures
import re

import pandas as pd

from toolbox.mlos import get_admin_col
from toolbox.exceptions import DataError
from toolbox.mlos.planfeld.microplan.dip_tools import prepare_dip_data, define_team_ranges, TemplateFields, \
    line_list_issues

DROP_COLS = [
    'Team Code Review', 'WardCode', 'UniqueTeamCode', 'Admin Code', 'H2H Teams',
    'Team Allocation Range', 'Lowest Team Code', 'Highest Team Code'
]


def merge_dip_with_team_dist(dip_data: pd.DataFrame, team_dist_data: pd.DataFrame, lga_col:str, ward_col: str) -> pd.DataFrame:
    print("Merging DIP with Team Distribution Data...")
    dip_data['WardCode'] = dip_data.apply(lambda row: f"{row[lga_col]}{row[ward_col]}", axis=1)
    team_lga, team_ward = [get_admin_col(team_dist_data, admin) for admin in ['lga', 'ward']]
    team_dist_data['Admin Code'] = team_dist_data.apply(lambda row: f"{row[team_lga]}{row[team_ward]}", axis=1)
    # team_dist_data = define_team_ranges(team_dist_data)

    dip = dip_data.merge(
        team_dist_data[['Admin Code', 'H2H Teams', "Team Allocation Range", 'Lowest Team Code', 'Highest Team Code']],
        how='left', left_on='WardCode', right_on='Admin Code'
    )

    dip['Lowest Team Code'] = dip['Lowest Team Code'].astype('Int64')
    dip['Highest Team Code'] = dip['Highest Team Code'].astype('Int64')

    return dip


def validate_team_codes(row: pd.Series, team_col) -> str | None:
    team_code: int |str = row[team_col]
    if pd.isna(team_code):
        return None

    min_team_code, max_team_code = row['Lowest Team Code'], row['Highest Team Code']
    def safe_convert(code: int | str):
        if isinstance(code, int):
            return code

        try:
            int_code = int(code)
            return int_code
        except (ValueError, TypeError):
            return None

    int_team_code = safe_convert(team_code)
    if not int_team_code:
        return None

    expected_range = range(min_team_code, max_team_code +1, 1)
    if int_team_code in expected_range:
        return None

    return f"Team Code {int(team_code)} is invalid"


def get_missing_team_codes(min_value: int, max_value: int, codes: list[str]):
    if pd.isna([min_value, max_value]).any():
        return "No Team Found"

    code_range = range(min_value, max_value+1, 1)
    missing_codes = [str(code) for code in code_range if str(code) not in codes]
    if len(missing_codes) >=1:
        return ", ".join(missing_codes)
    return None


def validate_ward_teams(ward_dip: pd.DataFrame, lga_col: str, ward_col: str, team_col: str) -> pd.DataFrame:
    unique_teams = ward_dip[team_col].unique().tolist()
    settlements = len(ward_dip)

    team_config = ward_dip.iloc[0]
    expected_teams, team_allocation = team_config["H2H Teams"], team_config["Team Allocation Range"]
    max_code, min_code = team_config["Highest Team Code"], team_config["Lowest Team Code"]
    lga, ward = team_config[lga_col], team_config[ward_col]
    team_count_validation = f'Missing {int(expected_teams - len(unique_teams))} Teams' if len(
        unique_teams) < expected_teams else None

    validation_data = {
        lga_col: [lga],
        ward_col: [ward],
        "Settlements": [settlements],
        "Team Allocation": [team_allocation],
        "Expected Teams": [expected_teams],
        "DIP Teams": [len(unique_teams)],
        "Team Count Validation": [team_count_validation]
    }

    missing_teams = get_missing_team_codes(min_code, max_code, unique_teams)
    if missing_teams:
        validation_data.update({"Missing Teams": [missing_teams]})

    return pd.DataFrame.from_dict(validation_data)


def validate_team_activity_days(team_dip: pd.DataFrame, fields: TemplateFields) -> pd.DataFrame:
    team_config = team_dip.iloc[0]
    lga, ward, team_code = team_config[fields.lga], team_config[fields.ward], team_config[fields.team]
    expected_days = ['1', '2', '3', '4']
    activity_day = team_dip[fields.activity_days].unique().tolist()
    valid_days = [day for day in activity_day if isinstance(day, str)]
    found_days: list[list] = [re.findall(r"\d", day) for day in valid_days]
    visit_days = set(chain.from_iterable(found_days))
    day_validation_data: dict = {
        fields.lga: [lga],
        fields.ward: [ward],
        fields.team: [team_code],
        fields.settlement: [len(team_dip)],
        fields.activity_days: [", ".join(map(str, visit_days))],
        "Missing Days": [None]
    }

    missing_days = [day for day in expected_days if day not in visit_days]
    if len(missing_days) >= 1:
        missed_days = ", ".join(missing_days)
        day_validation_data.update({"Missing Days": [missed_days]})

    return pd.DataFrame.from_dict(day_validation_data)


def validate_ward_dip(dip_data: pd.DataFrame, template_fields: TemplateFields):
    ward_dfs = [ward_df for _, ward_df in dip_data.groupby("WardCode")]
    reviewed_ward_dfs: list[pd.DataFrame] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        ward_futures = [executor.submit(
            validate_ward_teams, ward_df, template_fields.lga, template_fields.ward, template_fields.team)
            for ward_df in ward_dfs
        ]

        for future in concurrent.futures.as_completed(ward_futures):
            result = future.result()
            reviewed_ward_dfs.append(result)

    reviewed_ward_df = pd.concat(reviewed_ward_dfs, ignore_index=True)
    reviewed_ward_df.sort_values(
        by=[template_fields.lga, template_fields.ward, "Settlements"], inplace=True)
    return reviewed_ward_df.reset_index(drop=True)


def validate_team_plan(dip_data: pd.DataFrame, fields: TemplateFields) -> pd.DataFrame:
    print("Reviewing Team Codes Input against Team Code Allocations")
    team_dfs = [team_df for _, team_df in dip_data.groupby("unique_team_code")]

    reviewed_team_dfs: list[pd.DataFrame] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(validate_team_activity_days, team_df, fields) for team_df in team_dfs]

        for future in concurrent.futures.as_completed(futures):
            reviewed_team_dfs.append(future.result())

    processed_result: pd.DataFrame = pd.concat(reviewed_team_dfs, ignore_index=True)
    processed_result.sort_values(by=[fields.lga, fields.ward, fields.team], inplace=True)
    return processed_result.reset_index(drop=True)


def review_validation(review_data_map: dict[str, pd.DataFrame], fields: TemplateFields) -> None:
    result_map = {}
    print("Reviewing Validation...")
    review_col_map =  {
        'dip': ("Team Code Validation", "ignore"),
        'ward_review': ("Team Count Validation", "ignore"),
        'team_review': ("Missing Days", "ignore"),
    }

    for title, df in review_data_map.items():
        review_col, action = review_col_map[title]
        issues_count = len(df.loc[df[review_col].notna(), review_col].unique().tolist())
        if issues_count == 0:
            continue

        issues = line_list_issues(df, review_col, fields)
        if action == 'raise':
            raise DataError('Serious DIP Error Encountered', issues)

        result_map[review_col] = issues

    # print("Issues: {result_map}".format(result_map=result_map))
    return


def validate_daily_implementation_plan(
        dip: pd.DataFrame,
        team_distribution: pd.DataFrame=None,
        referred:bool=False) -> tuple[dict[str, pd.DataFrame], TemplateFields] | dict[str, pd.DataFrame]:

    std_dip, fields = prepare_dip_data(dip)
    print("Validating Daily Implementation Plan...")
    enriched_dip = merge_dip_with_team_dist(std_dip, team_distribution, fields.lga, fields.ward)
    enriched_dip['Team Code Validation'] = enriched_dip.apply(validate_team_codes, args=(fields.team, ), axis=1)
    ward_review = validate_ward_dip(enriched_dip, fields)
    team_review = validate_team_plan(enriched_dip, fields)
    review_datasets = {
        'dip': enriched_dip,
        'ward_review':ward_review,
        'team_review': team_review,
    }

    review_validation(review_datasets, fields)
    enriched_dip.drop(columns=DROP_COLS, inplace=True, errors='ignore')

    if referred:
        return review_datasets, fields

    return review_datasets


if __name__ == '__main__':
    folder = r"C:\\Workspace\\MLoS\\PLANFELD\\MICROPLANS\\APRIL 2026"
    dip_df: pd.DataFrame = pd.read_csv(f'{folder}\\NIPDS April Round Compiled DIP.csv')
    distribution_data: pd.DataFrame = pd.read_excel(f"{folder}\\Kebbi April Round Team Distribution.xlsx")
    res = validate_daily_implementation_plan(dip_df, distribution_data, True)
