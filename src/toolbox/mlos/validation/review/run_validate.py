import pandas as pd
import numpy as np

from toolbox.validators.prefilter import flag_validated_unknown_settlements
from toolbox.validators.spatial.spatial_checks import run_spatial_checks
from toolbox.mlos import get_admin_col, evaluate_settlement_validation
from toolbox.spatial_mgr import GeomColumns
from toolbox.configs import CONFIG, PCONFIG
from toolbox.tools import issues_counter
from toolbox.mlos import MLoSAttributes
from toolbox.models import State
from toolbox.validators import (
    find_duplicate_attributes,
    validate_attributes_entry,
    review_attributes_consistency,
    duplicate_deep_search_protocol
)


def flag_settlements(settlement_data: pd.DataFrame, report_cols: list[str]):
    query = " | ".join([f"({col}.notnull())" for col in report_cols])
    settlement_data = settlement_data.eval(f"is_flagged={query}", engine='python')
    settlement_data['is_flagged'] = settlement_data['is_flagged'].replace({True: 'Flagged', False: np.nan})

    issues_counter(settlement_data, 'is_flagged', 'Total Flagged', suffix=True)
    return settlement_data


async def run_settlements_qc(settlement: pd.DataFrame, admin_code: str, state: State, consistency: bool, deep_search: bool)-> pd.DataFrame:
    geo_columns: GeomColumns = GeomColumns.get_geom_cols(settlement, True)
    mlos_attribute = MLoSAttributes()(settlement, CONFIG.get('ATTRIBUTE_COLUMNS'))
    settlement = flag_validated_unknown_settlements(settlement, mlos_attribute)
    validated_unknown_settlements = settlement.loc[settlement['is_invalid'] == True]
    validated_unknown_settlements['validation_status'] = 'Validated Unknown'
    settlement = settlement.loc[settlement['is_invalid'] == False]
    main_columns: list = settlement.columns

    print('Running QC Checks...')
    attribute_checked = find_duplicate_attributes(settlement, geo_columns, admin_code)
    spatially_checked = run_spatial_checks(attribute_checked, state, geo_columns, admin_code)
    entries_checked = validate_attributes_entry(spatially_checked, mlos_attribute)

    if consistency:
        print('Running Consistency Checks on Attribute Entries...')
        entries_checked = review_attributes_consistency(entries_checked, mlos_attribute)

    if deep_search:
        print('Running In-depth Duplicate check')
        ward_col = get_admin_col(entries_checked, 'ward', error='raise')
        entries_checked = duplicate_deep_search_protocol(entries_checked, ward_col, admin_code, geo_columns)

    final_checked = entries_checked.sort_values(by=admin_code, ignore_index=True)
    final_checked.drop(columns=['geometry', 'is_nearby', 'distance', 'index_right'], inplace=True, errors='ignore')
    report_columns = [col for col in final_checked.columns if col not in main_columns]

    print('Flag Settlements with QC Issues...')
    final_check = flag_settlements(final_checked, report_columns)
    final_check = evaluate_settlement_validation(final_check, mlos_attribute)

    qc_ed_mlos = pd.concat([final_check, validated_unknown_settlements], ignore_index=True)
    qc_ed_mlos.sort_values(by=[admin_code], inplace=True, ignore_index=True)

    return qc_ed_mlos


if __name__ == '__main__':
    import asyncio
    mlos = pd.read_csv(r"C:\Users\enyinnaya.nwaiwu\Downloads\MLoS May 2026_fixed_20260525_fixed_20260525.csv")
    asyncio.run(
        run_settlements_qc(mlos, 'unique_code', State.Kebbi, False, False)
    )
