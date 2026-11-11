import pandas as pd

from toolbox.mlos.validation.review.prefilter import flag_validated_unknown_settlements
from toolbox.mlos.validation.review.spatial.spatial_checks import run_spatial_checks
from toolbox.mlos.validation.review.summarize import flag_settlements
from toolbox.mlos import evaluate_settlement_validation
from toolbox.spatial_mgr import GeomColumns
from toolbox.mlos import MLoSAttributes
from toolbox.configs import CONFIG
from toolbox.utils.offload import run_heavy
from toolbox.mlos.validation.review import (
    find_duplicate_attributes,
    validate_attributes_entry,
    review_attributes_consistency,
    duplicate_deep_search_protocol
)


def _run_settlements_qc(settlement: pd.DataFrame, admin_code: str, consistency: bool, deep_search: bool)-> pd.DataFrame:
    geo_columns: GeomColumns = GeomColumns.get_geom_cols(settlement, True)
    mlos_attribute = MLoSAttributes()(settlement, CONFIG.get('ATTRIBUTE_COLUMNS'))
    settlement = flag_validated_unknown_settlements(settlement, mlos_attribute)
    validated_unknown_settlements = settlement.loc[settlement['is_invalid'] == True]
    validated_unknown_settlements['validation_status'] = 'Validated Unknown'
    settlement = settlement.loc[settlement['is_invalid'] == False]
    main_columns: list = settlement.columns

    print('Running QC Checks...')
    attribute_checked = find_duplicate_attributes(settlement, geo_columns, admin_code)
    spatially_checked = run_spatial_checks(attribute_checked, geo_columns, admin_code)
    entries_checked = validate_attributes_entry(spatially_checked, mlos_attribute)

    if consistency:
        print('Running Consistency Checks on Attribute Entries...')
        entries_checked = review_attributes_consistency(entries_checked, mlos_attribute)

    if deep_search:
        print('Running In-depth Duplicate check')
        entries_checked = duplicate_deep_search_protocol(
            entries_checked, unique_admin_col=admin_code, geom_cols=geo_columns,
            output='update', cross_reference=False, threshold=92)

    final_checked = entries_checked.sort_values(by=admin_code, ignore_index=True)
    final_checked.drop(columns=['geometry', 'is_nearby', 'distance', 'index_right'], inplace=True, errors='ignore')
    report_columns = [col for col in final_checked.columns if col not in main_columns]

    print('Flag Settlements with QC Issues...')
    final_check = flag_settlements(final_checked, report_columns)
    final_check = evaluate_settlement_validation(final_check, mlos_attribute)

    qc_ed_mlos: pd.DataFrame = pd.concat([final_check, validated_unknown_settlements], ignore_index=True)
    qc_ed_mlos.sort_values(by=[admin_code], inplace=True, ignore_index=True)
    return qc_ed_mlos


async def run_settlements_qc(settlement: pd.DataFrame, admin_code: str, consistency: bool, deep_search: bool)-> pd.DataFrame:
    # The attribute, spatial and duplicate checks are minutes of pandas work: run them in a worker thread (hardening H7).
    return await run_heavy(_run_settlements_qc, settlement, admin_code, consistency, deep_search)


if __name__ == '__main__':
    import asyncio
    settlement = pd.read_excel(r"C:\Workspace\NEOC\MLOS\MLoS_v13_1_Tentative.xlsx")
    asyncio.run(
        run_settlements_qc(
            settlement, 'unique_code', False, False
        )
    )
