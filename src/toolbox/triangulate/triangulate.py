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
        methods: list[TriangulationMethod], unique_settlement_code: str, aoi: State):

    triangulated_list = settlement_data.copy()
    source_names = [source for source in submission_datasets.keys()]
    if TriangulationMethod.COORDS in methods:
        triangulated_list = triangulate_by_location(triangulated_list, submission_datasets, unique_settlement_code)

    if TriangulationMethod.SETTLEMENT in methods:
        submission_datasets = {source: dataset for source, dataset in submission_datasets.items() if source!='tracks'}
        triangulated_list = triangulate_by_settlement(triangulated_list, unique_settlement_code, submission_datasets, aoi)

    logging.info('Generating and Counting Supplementary Data Sources')

    tqdm.pandas(desc='Evaluating REACH')
    triangulated_list['sources'] = triangulated_list.progress_apply(populate_sources, args=(source_names,), axis=1)
    triangulated_list['reach'] = triangulated_list.progress_apply(evaluate_reach, axis=1)
    triangulated_list['visitation'] = triangulated_list['reach'].progress_apply(lambda x: "Visited" if x>=1 else "Not Visited")
    triangulated_list.drop(columns=source_names, inplace=True)

    return triangulated_list


if __name__ == '__main__':
    from toolbox.models import TriangulationMethod, State
    folder = "C:\\Workspace\\NIPDs\\APRIL ROUND"
    settlements = pd.read_csv(f"{folder}\\Kebbi_April_Round_Settlements.csv")
    submission_file = f"{folder}\\Submissions\\Kebbi April FiPV Submission Datasets.xlsx"
    sheets = pd.ExcelFile(submission_file).sheet_names
    submissions = {}
    for sheet in sheets:
        sheet_data = pd.read_excel(submission_file,sheet_name=sheet)
        submissions[sheet] = sheet_data

    result = triangulating_reached_settlements(
        settlements, submissions, [TriangulationMethod.SETTLEMENT],
        'Admin Code', State.Kebbi
    )