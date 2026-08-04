import logging

import numpy as np
import pandas as pd

from toolbox.campaign import CampaignDatasets
from toolbox.models import CampaignDay
from toolbox.campaign.campaign_tools import (
    detect_day_column,
    final_coverage_update,
    update_day_visitation,
    set_cumulative_visitation
)

def prepare_dip_data(dip_data: pd.DataFrame, campaign_day: int) -> pd.DataFrame:
    # dip_data.drop(columns=['Prev_Coverage', 'visitation', 'is_cumm'], errors='ignore', inplace=True)
    if 'Coverage' not in dip_data.columns:
        dip_data['Prev_Coverage'] = 0
    else:
        dip_data.rename(columns={'Coverage': 'Prev_Coverage'}, errors='ignore', inplace=True)

    return dip_data


def update_dip_data(campaign_datasets: CampaignDatasets, summary_data: pd.DataFrame,ta_col: str) -> tuple[pd.DataFrame, str]:

    logging.info('Setting DIP Visitation Status')
    analysis_day = campaign_datasets.campaign_day.analysis_day

    dip_df = prepare_dip_data(campaign_datasets.settlements, analysis_day)
    logging.info("Joining DIP to Gridded summary data")
    updated_dip_data = dip_df.merge(
        summary_data[['visitation', 'Coverage', 'track_count']],
        how='left', left_on=campaign_datasets.unique_code, right_on=ta_col
    )

    updated_dip_data = set_cumulative_visitation(updated_dip_data, analysis_day)

    logging.info(f"Updating Visitation and Final Coverage for Day {analysis_day}")
    day_col = get_activity_day(updated_dip_data, analysis_day)
    if day_col:
        updated_dip_data[day_col] = updated_dip_data.apply(
            update_day_visitation, args=(analysis_day, day_col), axis=1)

    updated_dip_data['time_spent_mins'] = updated_dip_data['track_count'] * 2
    # updated_dip_data[['Coverage', 'Prev_Coverage']].replace({0: np.nan}, inplace=True)
    updated_dip_data['Coverage'] = updated_dip_data.apply(final_coverage_update, axis=1)
    updated_dip_data.loc[updated_dip_data[
        f'day_{analysis_day}_cumm'].isna(), [f'day_{analysis_day}_cumm']]='Not Yet Visited'
    updated_dip_data = manage_mop_up(campaign_datasets.campaign_day, updated_dip_data)

    return updated_dip_data, day_col


def manage_mop_up(campaign_day: CampaignDay, dip_data: pd.DataFrame) -> pd.DataFrame:
    if campaign_day.is_mop_up:
        cum_col = f'day_{campaign_day.analysis_day}_cumm'
        dip_data.loc[dip_data[cum_col]=='Not Yet Visited', [cum_col]] = 'Not Visited'

    return dip_data


def get_activity_day(dip_data: pd.DataFrame, campaign_day: int) -> str | None:
    """To be Used to Create Day Column if not present especially for planned lists without DIPs and Mopup Days"""
    day_col: str = detect_day_column(campaign_day, dip_data, 'ignore')
    if day_col and not day_col.__contains__('cumm'):
        return day_col

    columns = [col for col in dip_data.columns]
    if campaign_day == 1:
        dip_data.insert(len(columns), 'day_1', 'Yes')
        return 'day_1'

    previous_day = detect_day_column(campaign_day-1, dip_data,  'ignore')
    if not previous_day:
        return None

    previous_day_loc = columns.index(previous_day)
    dip_data.insert(previous_day_loc+1, f'day_{campaign_day}', 'Yes')
    return f'day_{campaign_day}'
