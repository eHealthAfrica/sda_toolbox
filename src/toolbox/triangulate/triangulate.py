import logging

import pandas as pd
from tqdm import tqdm

from toolbox.models import TriangulationMethod, State
from toolbox.triangulate.by_coords import triangulate_by_location
from toolbox.triangulate.by_settlement import triangulate_by_settlement
from toolbox.triangulate.ttools import evaluate_reach, populate_sources
from toolbox.utils import timer


@timer
def triangulating_reached_settlements(
        settlement_data: pd.DataFrame, submission_datasets: dict[str, pd.DataFrame],
        methods: list[TriangulationMethod], unique_settlement_code: str, aoi: list[State]):

    triangulated_list = settlement_data.copy()
    source_names = [source for source in submission_datasets.keys()]
    if TriangulationMethod.COORDS in methods:
        triangulated_list = triangulate_by_location(triangulated_list, submission_datasets, unique_settlement_code)

    if TriangulationMethod.SETTLEMENT in methods:
        submission_datasets = {source: dataset for source, dataset in submission_datasets.items() if source!='GTS'}
        triangulated_list = triangulate_by_settlement(triangulated_list, unique_settlement_code, submission_datasets, aoi)

    logging.info('Generating and Counting Supplementary Data Sources')

    tqdm.pandas(desc='Evaluating REACH')
    triangulated_list['sources'] = triangulated_list.progress_apply(populate_sources, args=(source_names,), axis=1)
    triangulated_list['reach'] = triangulated_list.progress_apply(evaluate_reach, axis=1)
    triangulated_list['status'] = triangulated_list['reach'].progress_apply(lambda x: "Visited" if x>=1 else "Not Visited")
    triangulated_list.drop(columns=source_names, inplace=True, errors='ignore')

    return triangulated_list


if __name__ == '__main__':
    from toolbox.models import TriangulationMethod, State
    from toolbox.mlos import get_admin_col
    folder = "C:\\Workspace\\NEOC\\IBRA\\August Round"
    settlements = pd.read_csv(f"{folder}\\Compiled IBRA R2 Settlements.csv")
    submission_file = f"{folder}\\Submissions\\Standardized\\August 2026 IBRA 2 Campaign Submissions.xlsx"
    sheets = pd.ExcelFile(submission_file).sheet_names
    submissions = {}
    for sheet in sheets:
        if sheet != 'Fionet':
            continue
        sheet_data = pd.read_excel(submission_file,sheet_name=sheet)
        submissions[sheet] = sheet_data

    state_col = get_admin_col(settlements, 'state')
    state_names = settlements[state_col].str.strip().str.title().unique().tolist()
    states = [State[s_name] for s_name in state_names]

    result = triangulating_reached_settlements(
        settlements, submissions, [TriangulationMethod.SETTLEMENT, TriangulationMethod.COORDS],
        'unique_code', states
    )
