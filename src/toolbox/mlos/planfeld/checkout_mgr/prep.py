import logging

import pandas as pd

from toolbox.models import Policy
from toolbox.configs import CONFIG
from toolbox.fixers import populate_takeoff_point
from toolbox.mlos import AdminColumns, get_admin_col, MLoSAttributes
from toolbox.mlos.planfeld.checkout_mgr import review_takeoff_points


def validate_settlements_takeoff_points(db_data: pd.DataFrame, mlos: pd.DataFrame):
    schema_admin = AdminColumns(**{
        admin: get_admin_col(db_data, admin, 'raise') for admin in
        ['state', 'lga', 'ward', 'settlement']
    })

    mlos_admin = AdminColumns(**{
        admin: get_admin_col(mlos, admin, 'raise') for admin in
        ['state', 'lga', 'ward', 'settlement']
    })

    attrs = MLoSAttributes()
    attrs_config = CONFIG.get('ATTRIBUTE_COLUMNS')
    db_attrs = attrs(db_data, attrs_config, Policy.MP)
    mlos_attrs = attrs(mlos_data, attrs_config)

    if pd.isna(mlos[mlos_attrs.take_off_point]).any():
        logging.warning("Some Settlements do not have takeoff point")
        logging.info("Attempting to Populate Take Off Point")
        mlos = populate_takeoff_point(mlos, mlos_attrs.take_off_point)

    review_takeoff_points(mlos, mlos_attrs, mlos_admin, db_data, db_attrs, schema_admin)
    # Todo Step1: Review Takeoff Point
    # Todo Step2: Convert to GeoDataFrame
    # Todo Step3: Get All Attributes columns from the DB list
    # Todo Step4:
    # Todo Step2: Isolate New Settlements (current method in Update module should be able to handle this)
    return


if __name__ == '__main__':
    db_settlements = pd.read_csv(r"C:\Workspace\MLoS\PLANFELD\db_settlement_list.csv")
    mlos_data = pd.read_csv(r"C:\Workspace\MLoS\validation\V12\Kebbi_MLoS_v12.0_test.csv")
    validate_settlements_takeoff_points(db_settlements, mlos_data)
