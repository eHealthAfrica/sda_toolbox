import pandas as pd

from toolbox.mlos.planfeld.checkout_mgr.tools import generate_take_off_attributes
from toolbox.mlos.transformers import standardize_take_off_point
from toolbox.mlos import MLoSAttributes, AdminColumns
from toolbox.tools import find_column, is_empty


def retrieve_admin_code_mapping(settlements: pd.DataFrame) -> dict:
    code_col_map = {
        code_col: find_column(settlements, code_col, 'raise')
        for code_col in ['take_off_point_code', 'ward_code', 'lga_code', 'state_code']
    }

    return code_col_map


def get_takeoff_data(
        settlements: pd.DataFrame, admin: AdminColumns, attributes: MLoSAttributes,
        ward_code: str=None, takeoff_code: str=None):

    cols = [admin.lga, admin.ward, attributes.take_off_point]
    if takeoff_code:
        cols.insert(-1, takeoff_code)

    if ward_code:
        cols.insert(0, ward_code)

    return settlements.loc[:, cols].drop_duplicates(subset=[admin.ward, attributes.take_off_point]).reset_index(drop=True)


def tmp_code(ward_name: str, takeoff: str):
    if any(is_empty(value) for value in [ward_name, takeoff]):
        return None

    return f"{ward_name.lower()}_{takeoff.lower()}"


def review_takeoff_points(
        mlos_data: pd.DataFrame, mlos_attributes: MLoSAttributes, mlos_admin: AdminColumns,
        db_data: pd.DataFrame, db_attributes: MLoSAttributes, db_admin: AdminColumns):

    db_data = standardize_take_off_point(db_data, db_attributes)
    mlos_data = standardize_take_off_point(mlos_data, mlos_attributes)
    admin_code_map = retrieve_admin_code_mapping(db_data)
    db_takeoff_data = get_takeoff_data(
        db_data, db_admin,
        db_attributes,
        admin_code_map['ward_code'],
        admin_code_map['take_off_point_code']
    )

    mlos_takeoff_data = get_takeoff_data(mlos_data, mlos_admin, mlos_attributes)
    mlos_takeoff_data['code'] = mlos_takeoff_data.apply(
        lambda row: tmp_code(row[mlos_admin.ward], row[mlos_attributes.take_off_point]), axis=1)

    db_takeoff_data['code'] = db_takeoff_data.apply(
        lambda row: tmp_code(row[db_admin.ward], row[db_attributes.take_off_point]), axis=1)

    joined = mlos_takeoff_data.merge(db_takeoff_data, on='code', how='left', suffixes=[None, '_db'])
    if pd.notna(joined[f'{db_attributes.take_off_point}_code']).all():
        return db_takeoff_data

    joined.drop(columns=['code', f'{db_admin.ward}_db', db_attributes.take_off_point, f"{db_admin.lga}_db"], inplace=True)
    take_off_data = generate_take_off_attributes(
        joined,
        admin_code_map['ward_code'],
        mlos_attributes.take_off_point,
        mlos_admin.ward,
       f'{db_attributes.take_off_point}_code')

    return take_off_data
