from uuid import uuid4, UUID

import pandas as pd

from toolbox.tools import find_column
from toolbox.configs import CONFIG


def is_not_valid_uuid(text: str):
    if pd.isna(text):
        return True

    try:
        UUID(text)
        return False
    except (ValueError, TypeError):
        return True


def generate_uuids(count: int):
  return [uuid4().hex for _ in range(0, count)]


def unique_uuids(uuids: list):
    return list(set(uuids))


def validate_generated_uuids(generated_uuids: list, existing_uuids: list) -> list:
    """
    Replaces any generated UUIDs that already exist in a given list.

    Args:
        generated_uuids: A list of newly generated UUIDs.
        existing_uuids: A list of UUIDs already in use.

    Returns:
        A new list with all UUIDs guaranteed to be unique.
    """

    duplicated_uuids = set(generated_uuids) & set(existing_uuids)

    # If there are no duplicates, return the original list
    if not duplicated_uuids:
        return generated_uuids

    # Create a new list without the duplicates
    new_unique_uuids = [uuid for uuid in generated_uuids if uuid not in duplicated_uuids]

    # Generate new UUIDs to replace the duplicates
    num_replacements = len(duplicated_uuids)
    while num_replacements > 0:
        new_uuid = generate_uuids(1)[0]  # Assuming generate_uuids returns a list
        if new_uuid not in unique_uuids and new_uuid not in existing_uuids:
            new_unique_uuids.append(new_uuid)
            num_replacements -= 1

    return new_unique_uuids


def populate_global_id(dataset: pd.DataFrame, uuid_col: str=None):
    guid_col_name = uuid_col if uuid_col else CONFIG['ATTRIBUTE_COLUMNS']['GUID']
    global_id_col = find_column(dataset, col_name=guid_col_name, error='ignore')
    if not global_id_col:
        data_count = len(dataset)
        uuids = generate_uuids(data_count)
        dataset[global_id_col] = uuids
        return dataset

    dataset['invalid_uuid'] = dataset[global_id_col].apply(is_not_valid_uuid)
    invalid_uuids = dataset[dataset['invalid_uuid']]
    if len(invalid_uuids) >= 1:
        print(f"Settlements with Missing {global_id_col} UUIDs: {len(invalid_uuids)}")
        valid_uuids = generate_uuids(len(invalid_uuids))
        valid_uuids = validate_generated_uuids(valid_uuids, dataset[global_id_col].tolist())
        dataset.loc[dataset['invalid_uuid'], [global_id_col]] = valid_uuids

    dataset.drop(columns='invalid_uuid', inplace=True)
    return  dataset

