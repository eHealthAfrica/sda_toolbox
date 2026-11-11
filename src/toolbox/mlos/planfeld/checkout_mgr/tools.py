import re
import logging
from uuid import uuid4

import pandas as pd
from tqdm import tqdm
import geopandas as gpd

from toolbox.configs import CONFIG
from toolbox.mlos import get_admin_col
from toolbox.tools import get_next_letter, get_field_index
from toolbox.tools import find_column, is_empty


# def get_ward_code(row: pd.Series, ward_col: str, ward_code_col: str, ref_data: pd.DataFrame):
#     ward_name = row[ward_col]
#     code = ref_data.loc[ref_data[ward_col]==ward_name, ward_code_col].iloc[0]
#     return int(code)


def has_suffix(codes: list[str]):
    matches =  [re.search(r'[A-Z]', code) for code in codes]
    if any(matches):
        suffixes = [suffix.group(0) for suffix in matches]
        return max(suffixes)

    return False


def generate_take_off_attributes(dataset: pd.DataFrame, ward:str) -> pd.DataFrame:
    takeoff_point = 'takeoffpoint'
    takeoffpoint_code = 'takeoffpoint_code'
    pending_dataset = dataset.loc[dataset[takeoffpoint_code].isna()]
    facilities = CONFIG['TAKE-OFF-POINTS']
    facilities_map = "|".join([f for f  in facilities])
    pattern = rf"\b({facilities_map})\b"
    pending_dataset['type']  = pending_dataset[takeoff_point].str.extract(pattern, expand=False)
    pending_dataset['type_code'] = pending_dataset['type'].map(facilities.get)
    dataset = dataset[~dataset.index.isin(pending_dataset.index.tolist())]
    pending_dataset[takeoffpoint_code] = pending_dataset.apply(lambda row: f"{row['ward_code']}/{row['type_code']}", axis=1)
    pending_dataset.drop(columns=['type', 'type_code'], inplace=True)
    pending_dataset['indicator'] = 'NEW'
    dataset = review_takeoff_duplication(pending_dataset, takeoffpoint_code, dataset)
    return dataset


def review_takeoff_duplication(takeoff_data: pd.DataFrame, take_off_code: str, reference_data:pd.DataFrame):
    reviewed = pd.DataFrame()
    takeoff_group = takeoff_data.groupby(by=take_off_code)
    for takeoff_code, takeoff in takeoff_group:
        exists = reference_data.loc[reference_data[take_off_code].str.match(takeoff_code)]
        if exists.empty:
            pass
        else:
            suffix = has_suffix(exists[take_off_code].tolist())
            if not suffix:
                reference_data.loc[reference_data[take_off_code]==takeoff_code, [take_off_code]]=f"{takeoff_code}A"
                takeoff.loc[:, [take_off_code]] = f"{takeoff_code}B"
            else:
                new_suffix = get_next_letter(suffix)
                takeoff.loc[:, [take_off_code]] = f"{takeoff_code}{new_suffix}"
                pass

        reviewed = pd.concat([reviewed, takeoff])

    return pd.concat([reference_data, reviewed]).sort_values(by=take_off_code)


def enrich_admin_codes(settlements: pd.DataFrame, ward_data: pd.DataFrame) -> pd.DataFrame:
    admins = ['state_name', 'lga_name', 'ward_name']
    codes = ['state_code', 'lga_code', 'ward_code']

    settlements['ward_id'] = settlements.apply(
        lambda row: f'{row['state_name']}_{row['lga_name']}_{row["ward_name"]}', axis=1)
    settlements['ward_id'] = settlements['ward_id'].str.lower()

    ward_data['ward_id'] = ward_data.apply(
        lambda row: f'{row['statename']}_{row['lganame']}_{row["wardname"]}', axis=1)
    ward_data['ward_id'] = ward_data['ward_id'].str.lower()

    enriched_settlements = settlements.merge(
        ward_data[['ward_id', 'statecode', 'lgacode', 'wardcode']], how='left', on=['ward_id'])

    for admin, code in zip(admins, codes):
        columns = enriched_settlements.columns.tolist()
        admin_index = get_field_index(columns, admin)
        admin_code = code.replace('_', '')
        enriched_settlements.insert(admin_index, code, enriched_settlements[admin_code], True)
        enriched_settlements.drop(columns=admin_code, inplace=True)

    return enriched_settlements


def tmp_code(row: pd.Series):
    ward_code = row['ward_code']
    takeoff = row['takeoffpoint']
    if any(is_empty(value) for value in [ward_code, takeoff]):
        return None

    return f"{ward_code.lower()}_{takeoff.lower()}"


def transfer_takeoff_codes(mlos: pd.DataFrame, db_takeoff: pd.DataFrame) -> pd.DataFrame:
    mlos['code'] = mlos.apply(tmp_code, axis=1)
    db_takeoff['db_code'] = db_takeoff.apply(tmp_code, axis=1)

    joined = mlos.merge(db_takeoff[['db_code', 'takeoffpoint_code']], left_on='code', right_on='db_code', how='left')
    takeoff_index = get_field_index(mlos.columns.tolist(), 'takeoffpoint')
    joined.insert(takeoff_index+1, 'takeoffpoint_code_mlos', joined['takeoffpoint_code'])
    joined = joined.drop(columns=['takeoffpoint_code', 'db_code', 'code']).rename(columns={'takeoffpoint_code_mlos': 'takeoffpoint_code'})
    return joined


def get_updated_records(db_data: gpd.GeoDataFrame, updated_db_data: gpd.GeoDataFrame) -> list[gpd.GeoDataFrame]:
    logging.info('Getting updated records')
    df_orig = db_data.set_index("eha_guid")
    df_new = updated_db_data.set_index("eha_guid")

    # 2. Align columns to shared set
    common_cols = [col for col in df_orig.columns if col in df_new.columns]
    df_orig = df_orig[common_cols]
    df_new = df_new[common_cols]

    # 3. Align rows to shared eha_guid index & order
    common_ids = df_orig.index.intersection(df_new.index)
    df_orig = df_orig.loc[common_ids]
    df_new = df_new.loc[common_ids]

    logging.info("Comparing Table to Find updated records")
    comparison = df_orig.compare(df_new, keep_shape=False)

    # 5. Extract updated rows from updated_db_data using changed index values
    changed_guids = comparison.index.unique()
    new_settlements = updated_db_data.loc[~updated_db_data['eha_guid'].isin(common_ids), ['eha_guid'] + common_cols]
    df_changed = df_new[df_new.index.isin(changed_guids)]
    df_changed.reset_index(names='eha_guid', inplace=True)

    return [df_changed, new_settlements]


def update_settlements(db_data: pd.DataFrame, mlos_data: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    db_cols = db_data.columns.tolist()
    exc_cols = ['last_updated', 'editor', 'timestamp', 'source', 'eha_guid', 'fc_globalid', 'settlementarea_globalid']
    update_cols = [col for col in db_cols if col not in exc_cols and col in mlos_data.columns] + ['eha_guid']

    logging.info('Identifying Pre-existing and New Settlements')
    new_settlements = mlos_data.loc[~mlos_data['eha_guid'].isin(db_data['eha_guid'])]
    settlements_updates = mlos_data[mlos_data['eha_guid'].isin(db_data['eha_guid'])]
    drop_uuids = db_data.loc[~db_data['eha_guid'].isin(mlos_data['eha_guid']), 'eha_guid'].unique().tolist()

    merged_db_data = db_data.merge(
        settlements_updates[update_cols], left_on='eha_guid', right_on='eha_guid', how='left', suffixes=(None, '_upd'))

    def update(row:pd.Series, field1: str, field2: str, enforce: bool):
        value1, value2 = row[field1], row[field2]
        if pd.isna([value1, value2]).all():
            return None

        if not is_empty(value1) and is_empty(value2) and enforce:
            return value1

        return value2

    logging.info('Updating Attributes')
    for col in tqdm(update_cols, desc='updating attributes'):
        enforcer = False
        if col == 'eha_guid':
            continue

        if col in ['geometry', 'latitude', 'longitude']:
            enforcer = True

        merged_db_data[col] = merged_db_data.apply(update, args=(col, f'{col}_upd', enforcer), axis=1)

    logging.info('Cleaning up Datasets')
    drop_cols = [f"{col}_upd" for col in update_cols]
    merged_db_data.drop(columns=drop_cols, inplace=True, errors='ignore')
    updated_db_data = pd.concat([new_settlements, merged_db_data], ignore_index=True)
    updated_db_data['settlementarea_globalid'] = updated_db_data['settlementarea_globalid'].apply(
        lambda row: str(uuid4()) if pd.isna(row) else row)

    return updated_db_data, drop_uuids


