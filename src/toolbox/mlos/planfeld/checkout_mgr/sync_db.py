from dataclasses import dataclass

import pandas as pd
import geopandas as gpd

from toolbox.mlos.validation.review.summarize import categorize_flags, major_flag_check
from toolbox.mlos.validation.review.run_validate import run_settlements_qc
from toolbox.mlos import detect_unique_admin_field, construct_new_unique
from toolbox.models import State


@dataclass
class CheckoutDatasets:
    settlements: gpd.GeoDataFrame
    take_off_point: gpd.GeoDataFrame


async def synchronize_checkout_datasets(settlements: pd.DataFrame, checkout_datasets: CheckoutDatasets, state: State):
    unique_code: str = detect_unique_admin_field(settlements)
    if not unique_code:
        unique_code = 'unique_code'
        settlements = construct_new_unique(settlements, unique_code)

    settlement_qc_ed = await run_settlements_qc(settlements, unique_code, state, True, False)
    settlement_qc_ed = categorize_flags(settlement_qc_ed)
    major_flags = major_flag_check(settlement_qc_ed)
    if major_flags:
        print("Major QC Flags were Identified in Settlements Data")
        return settlement_qc_ed

    ...


if __name__ == '__main__':
    from toolbox.access.read_mgr import read_dataset
    from toolbox.configs import CONFIG
    import asyncio

    data_config = CONFIG['DATASETS']
    db = "C:\\Workspace\\MLoS\\PLANFELD\\kb_mlos_checkout_03april2026.sqlite"

    mlos = pd.read_csv("C:\\Users\\enyinnaya.nwaiwu\\Downloads\\Tentative May 2026 MLoS V2.csv")
    db_settlement = asyncio.run(read_dataset(db, True, data_config['db_settlements']))
    db_takeoff = asyncio.run(read_dataset(db, True, data_config['db_takeoff_points']))

    datasets: CheckoutDatasets = CheckoutDatasets(db_settlement, db_takeoff)

    asyncio.run(
        synchronize_checkout_datasets(mlos, datasets, State.Kebbi)
    )
