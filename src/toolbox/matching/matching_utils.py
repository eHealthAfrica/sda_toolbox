import numpy as np
import pandas as pd
from tqdm import tqdm
from fuzzywuzzy import process

from toolbox.tools import select_highest


def search_item(row: pd.Series, col: str, searchable: list) -> float | str:
    unique = row[col]
    matches: list[tuple[str, float]] = process.extractBests(unique, searchable, score_cutoff=96)
    if not matches:
        return np.nan

    if len(matches) > 1:
        found: str = select_highest(matches)
    
    else:
        found: str = matches[0][0]
    
    return found

def match_settlements(settlements: pd.DataFrame, searching: list, master_col: str, unique_col: str) -> pd.DataFrame:
    tqdm.pandas(desc='Checking')
    settlements[master_col] = settlements.progress_apply(search_item, args=(unique_col, searching), axis=1)
    return settlements