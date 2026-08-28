from functools import lru_cache

import pandas as pd
from fuzzywuzzy import process

from toolbox.mlos import AdminColumns


def update_reach(row: pd.Series, source_field: str, target_field: str) -> str | None:
    new_value = row.get(source_field)
    existing_value = row.get(target_field)

    if pd.isna([existing_value, new_value]).all():
        return None

    # if pd.notna([existing_value, new_value]).any():
    #     return target_field
    #
    # if pd.isna(new_value):
    #     return existing_value

    return target_field


def set_reach(settlement_data: pd.DataFrame, target_field: str, source_name: str=None):
    source_name = source_name if source_name else target_field
    settlement_data[source_name] = settlement_data.apply(update_reach, args=(target_field, source_name), axis=1)
    return settlement_data


def evaluate_reach(row: pd.Series) -> int:
    source: str = row.get('sources')
    if pd.isna(source):
        return 0

    return source.split(" | ").__len__()


def populate_sources(row: pd.Series, sources: list) -> str | None:
    sources = [row.get(source) for source in sources]
    if pd.isna(sources).all():
        return None

    non_null_sources = list(filter(lambda source: pd.notna(source), sources))
    return " | ".join(non_null_sources)


@lru_cache
def compare_standardizer_ii(admin_name: str, admin_names: list) -> str:
    match = process.extractBests(admin_name, admin_names, score_cutoff=80, limit=1)
    if not match:
        return admin_name

    return match[0][0]