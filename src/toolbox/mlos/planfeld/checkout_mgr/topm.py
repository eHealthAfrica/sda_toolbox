import pandas as pd

from toolbox.mlos.planfeld.checkout_mgr.tools import generate_take_off_attributes, transfer_takeoff_codes
from toolbox.mlos.transformers import standardize_take_off_point
from toolbox.mlos import MLoSAttributes, AdminColumns


def attempt_takeoff_correction():
    pass


def new_takeoff_exists(sett_takeoff: list[str], db_sett_takeoff: list) -> bool:
    if missing_takeoff := [tko for tko in sett_takeoff if tko not in db_sett_takeoff]:
        return True

    return False


def get_takeoff_data(
        settlements: pd.DataFrame, admin: AdminColumns, takeoff_point: str, takeoff_code: str| None=None):

    cols = [admin.state, 'state_code', admin.lga, 'lga_code', admin.ward, 'ward_code', takeoff_point]
    if takeoff_code:
        cols.insert(-1, takeoff_code)

    return settlements.loc[:, cols].drop_duplicates(subset=[admin.ward, takeoff_point]).reset_index(drop=True)


def review_takeoff_points(
        mlos_data: pd.DataFrame, mlos_attributes: MLoSAttributes, mlos_admin: AdminColumns,
        db_data: pd.DataFrame, db_attributes: MLoSAttributes, db_admin: AdminColumns):

    db_data = standardize_take_off_point(db_data, db_attributes)
    mlos_data = standardize_take_off_point(mlos_data, mlos_attributes)
    settlements_takeoff = mlos_data[mlos_attributes.take_off_point].unique().tolist()
    db_takeoff = db_data[db_attributes.take_off_point].unique().tolist()
    has_new_takeoff = new_takeoff_exists(settlements_takeoff, db_takeoff)
    db_takeoff_data = get_takeoff_data(
        db_data,
        db_admin,
        db_attributes.take_off_point,
        'takeoffpoint_code'
    )

    mlos_data.rename({mlos_attributes.take_off_point: db_attributes.take_off_point}, axis=1, inplace=True)
    updated_mlos = transfer_takeoff_codes(mlos_data, db_takeoff_data)
    if has_new_takeoff:
        updated_mlos = generate_take_off_attributes(updated_mlos, mlos_admin.ward)

    return updated_mlos
