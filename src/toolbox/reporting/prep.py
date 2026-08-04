import pandas as pd

from toolbox.configs import CONFIG
from toolbox.models import Scheme


def retrieve_color_scheme(values: list, scheme: Scheme)->dict[str, str]:
    scheme: dict = CONFIG['REPORTING'][scheme.value]
    return {field: scheme.get(field) for field in values}


def generate_summary_data(data: pd.DataFrame, visitation_col: str) -> pd.DataFrame:
    report_data: pd.DataFrame = (
        data.groupby(by=visitation_col).size().reset_index(name='count')
        .sort_values(by=visitation_col, ascending=False)
        .reset_index(drop=True)
    )

    return report_data


def generate_breakdown_data(data: pd.DataFrame, breakdown_col: str, visitation_col: str) -> pd.DataFrame:
    report_data: pd.DataFrame = data.groupby(by=[breakdown_col, visitation_col]).size().unstack()
    return report_data


def get_report_values(data: pd.DataFrame, visitation_col: str, sort: bool)->list:
    report_values = data.loc[data[visitation_col].notnull(), visitation_col].unique().tolist()
    return sorted(report_values, reverse=sort) if sort else report_values
