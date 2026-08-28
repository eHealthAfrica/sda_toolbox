import pandas as pd

from toolbox.mlos import get_admin_col
from toolbox.reporting import PostImplementationReport, PostReport


def generate_post_implementation_report(tracking_data: pd.DataFrame, reporting_col: str) -> list[PostReport]:
    state, lga, ward = [get_admin_col(tracking_data, col, 'raise') for col in ['state', 'lga', 'ward']]
    tracking_data[lga] = tracking_data[lga].str.replace('/', '-')
    tracking_data[ward] = tracking_data[ward].str.replace('/', '-')
    tracking_data['lga_code'] = tracking_data.apply(lambda row: f"{row[state]}_{row[lga]}", axis=1)
    tracking_data['ward_code'] = tracking_data.apply(lambda row: f"{row['lga_code']}_{row[ward]}", axis=1)

    post_implementation_report = PostImplementationReport(tracking_data, reporting_col)
    post_report: list[PostReport] = post_implementation_report.generate_report()

    return post_report