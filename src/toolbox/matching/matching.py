import multiprocessing
import concurrent.futures

import pandas as pd

from toolbox import CPU_COUNT
from toolbox.matching.matching_utils import match_settlements


def run_direct_match(data: pd.DataFrame, master_data: pd.DataFrame, unique_col: str, master_col: str) -> pd.DataFrame:
    updated_data = data.merge(
        master_data[master_col],
        how='inner',
        left_on=unique_col,
        right_on=master_col,
    )
    
    return updated_data


def run_fuzzy_match(chunks: list[pd.DataFrame], master_list: list[str], master_column: str, unique_column: str) -> pd.DataFrame:
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CPU_COUNT) as executor:
        futures = [
            executor.submit(match_settlements, chunk, master_list, master_column, unique_column)
            for chunk in chunks
        ]

        for future in  concurrent.futures.as_completed(futures):
            results.append(future.result())
    
    result = pd.concat(results, ignore_index=True)
    found_fuzzy = result.loc[result[master_column].notna()]

    return found_fuzzy