import numpy as np
import pandas as pd

from toolbox.tools import issues_counter


def flag_settlements(settlement_data: pd.DataFrame, report_cols: list[str]):
    query = " | ".join([f"({col}.notnull())" for col in report_cols])
    settlement_data = settlement_data.eval(f"is_flagged={query}", engine='python')
    settlement_data['is_flagged'] = settlement_data['is_flagged'].replace({True: 'Flagged', False: np.nan})

    issues_counter(settlement_data, 'is_flagged', 'Total Flagged', suffix=True)
    return settlement_data


def classify_flag(row: pd.Series) -> str | None:
    flagged = row['is_flagged']
    level = row['flag_level']

    if pd.isna(flagged):
        return None

    if not level:
        return 'Minor Flag'

    return 'Major Flag'


def categorize_flags(settlement_data: pd.DataFrame):
    gen_flags = ['stacked_point', 'duplicate_attribute', 'proximity_issues', 'WE_population', 'habitation_fidelity',
                 'settlement_type_fidelity']

    attr_flags = ['accessibility_status', 'security_compromised', 'urban', 'rural', 'scattered', 'habitational_status',
                  'eha_guid']

    attr_flags = [f"WE_{col}" for col in attr_flags]
    flag_cols = gen_flags + attr_flags
    query = " | ".join([f"({col}.notnull())" for col in flag_cols])
    settlement_data = settlement_data.eval(f"flag_level={query}", engine='python')
    settlement_data['Flag Level'] = settlement_data.apply(classify_flag, axis=1)
    return settlement_data


def major_flag_check(settlement_data: pd.DataFrame) -> bool:
    major_flags = any(flag == 'Major Flag' for flag in settlement_data['Flag Level'])
    return major_flags
