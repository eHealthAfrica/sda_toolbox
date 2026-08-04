import pandas as pd

from toolbox.campaign.campaign_tools import group_data
from toolbox.mlos import get_admin_col
from toolbox.tools import find_column


def populate_takeoff_point(dataset: pd.DataFrame, take_off_col: str| None=None) -> pd.DataFrame:
    ward_col = get_admin_col(dataset, admin_type='ward', error='raise')
    take_off_col = take_off_col if take_off_col else find_column(dataset, 'take_off_point')

    ward_group = group_data(dataset, column=ward_col)

    checked = []
    for group in ward_group:
        phcs = [phc for phc in group[take_off_col].unique().tolist() if pd.notna(phc)]
        if len(phcs) != 1:
            # Todo: Use catchment to populate
            checked.append(group)
        else:
            group.loc[:, take_off_col] = phcs[0]
            checked.append(group)

    return pd.concat(checked, ignore_index=True)


def health_facilities_catchment(dataset: pd.DataFrame):
    ...