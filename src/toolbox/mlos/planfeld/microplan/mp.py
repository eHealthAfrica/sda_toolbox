import re

import pandas as pd

from toolbox.tools import find_column


def determine_campaign_days(days: list[str]) -> int:
    days = [day for day in days if isinstance(day, str)]
    all_days = ", ".join([day.replace("Day ", "") for day in days])
    seen_days = set(re.findall(r'\d', all_days))
    campaign_days = max(seen_days, key=int)
    return int(campaign_days)


def set_dip(days: str, day_col: int):
    if pd.isna(days):
        return pd.NA

    days = re.findall(r'\d', days)
    if str(day_col) in days:
        return 'Yes'

    return pd.NA


def populate_daily_implementation_plan(microplan: pd.DataFrame):
    activity_day_col = find_column(microplan, 'Days')
    days_entries = microplan.loc[microplan['Days'].notnull(), activity_day_col].unique().tolist()
    campaign_duration = determine_campaign_days(days_entries)
    for num in range(1, campaign_duration + 1, 1):
        day_col = f'Day {num}'
        microplan.insert(len(microplan.columns), f'Day {num}', '')
        microplan[day_col] = microplan['Days'].apply(lambda x: set_dip(x, num))

    return microplan