import logging
from uuid import uuid4

import pandas as pd
import geopandas as gpd

from toolbox.models import Policy
from toolbox.configs import CONFIG, members
from toolbox.fixers import populate_takeoff_point
from toolbox.mlos import AdminColumns, get_admin_col, MLoSAttributes
from toolbox.mlos.planfeld.checkout_mgr import review_takeoff_points
from toolbox.spatial_mgr.spatial_ops import GeomColumns, convert_to_geodata


def populate_settlement_area_uuid(settlement: pd.DataFrame, db_settlements: pd.DataFrame):
    logging.info('Populating Settlement Area Global ID')
    settlement_upd = settlement.merge(db_settlements[['eha_guid', 'settlementarea_globalid']], on='eha_guid', how='left')
    settlement_upd.loc[settlement_upd['settlementarea_globalid'].isnull(), ['settlementarea_globalid']] = str(uuid4())
    return settlement_upd

def populate_editors(settlements: pd.DataFrame, aois: list[str]):
    logging.info('Populating Editors')
    state_analysts: dict[str, dict[str, str]] = members['mlos']
    for state in aois:
        analyst = state_analysts[state]['name'].lower().replace(' ', '.')
        settlements.loc[settlements['state_name'] == state, 'editor'] = analyst

    return settlements



def validate_settlements_takeoff_points(db_data: pd.DataFrame, mlos: pd.DataFrame) -> gpd.GeoDataFrame:
    schema_admin = AdminColumns.create_by_search(db_data)
    mlos_admin = AdminColumns.create_by_search(mlos)

    attrs = MLoSAttributes()
    attrs_config = CONFIG.get('ATTRIBUTE_COLUMNS')
    db_attrs = attrs(db_data, attrs_config, Policy.MP)
    mlos_attrs = attrs(mlos, attrs_config)

    if pd.isna(mlos[mlos_attrs.take_off_point]).any():
        logging.warning("Some Settlements do not have takeoff point")
        logging.info("Attempting to Populate Take Off Point")
        mlos = populate_takeoff_point(mlos, mlos_attrs.take_off_point)

    reviewed_settlements = review_takeoff_points(mlos, mlos_attrs, mlos_admin, db_data, db_attrs, schema_admin)
    reviewed_settlements.drop(columns=['globalid', 'ward_id'])
    geom_info = GeomColumns.get_geom_cols(reviewed_settlements, True)
    settlement_geodata = convert_to_geodata(reviewed_settlements, geom_info)
    return settlement_geodata

#
# if __name__ == '__main__':
#     db_settlements = pd.read_csv(r"C:\Workspace\MLoS\PLANFELD\db_settlement_list.csv")
#     mlos_data = pd.read_csv(r"C:\Workspace\MLoS\validation\V12\Kebbi_MLoS_v12.0_test.csv")
#     validate_settlements_takeoff_points(db_settlements, mlos_data)
