import logging
from dataclasses import dataclass, field
from functools import cached_property
from collections import Counter
from typing import Optional
import re

import numpy as np
import pandas as pd
from tqdm import tqdm
from fuzzywuzzy import process

from toolbox.spatial_mgr import GeomColumns
from toolbox.tools import detect_settlement_id_field
from toolbox.mlos import detect_unique_admin_field, construct_new_unique


def create_coord_id(dataset: pd.DataFrame, geom_cols: GeomColumns) -> pd.DataFrame:
    if geom_cols.not_found:
        dataset['coord_id'] = np.nan

    dataset['coord_id'] = dataset.apply(
        lambda row: f"{row[geom_cols.latitude]}_{row[geom_cols.longitude]}", axis=1)

    return dataset


@dataclass
class IndicatorColumns:
    visitation: Optional[str] = None
    coverage: Optional[str] = None
    time_spent: Optional[str] = None

    @classmethod
    def create_from_data(cls, data: pd.DataFrame) -> "IndicatorColumns":
        visitation_col = cls._get_visitation_col(data)
        coverage_col = cls._get_coverage_col(data)
        # time_spent_col = cls._get_timespent_col(data)

        return IndicatorColumns(
            visitation=visitation_col,
            coverage=coverage_col,
            # time_spent=time_spent_col
        )

    @staticmethod
    def _get_visitation_col(df: pd.DataFrame):
        def review() -> str | None:
            cols_idx = {}
            cols = df.columns.tolist()
            for idx, col in enumerate(cols):
                if df[col].dtype.name !='str':
                    continue

                if pd.isna(df[col]).any():
                    continue

                col_values: list[str] = df[col].unique().tolist()
                if any([value.title() not in ['Visited', 'Not Yet Visited', 'Not Visited'] for value in col_values]):
                    continue

                cols_idx[col] = idx

            return max(cols_idx, key=cols_idx.get) if cols_idx else None

        return review()

    @staticmethod
    def _get_coverage_col(df: pd.DataFrame):
        coverage_options: list = process.extractBests('coverage', df.columns.to_list(), score_cutoff=95)
        if not coverage_options:
            return None

        options = dict(coverage_options)
        cols: list[str] = [col for col in options.keys()]
        for col in cols:
            col_type = df[col].dtype.name
            if col_type == 'str':
                return col

            if col_type in ['int', 'float']:
                from toolbox.campaign.campaign_tools import classify_coverage
                df[col] = df[col] if max(df[col] ) <=1 else df[col ] /100
                df[col] = df[col].apply(classify_coverage)
                return col

            return None

        return None

    @staticmethod
    def _get_timespent_col(df: pd.DataFrame):
        return None

    def indicators(self):
        key_col_map = self.__dict__
        return {
            key: col for key, col in key_col_map.items()
            if isinstance(col, str)
        }


@dataclass
class Dataset:
    round: str
    state: str
    dataset: pd.DataFrame
    geom_cols: GeomColumns
    indicators: IndicatorColumns
    _unique_code: str = field(init=False)

    def __post_init__(self):
        self.dataset = create_coord_id(self.dataset, self.geom_cols)

        unique_code = detect_unique_admin_field(self.dataset)
        if not unique_code:
            unique_code = 'unique_code'
            self.dataset = construct_new_unique(self.dataset, unique_code)

        if self.round != 'baseline':
            indicators = self.indicators.indicators()
            renamer = {col_name: f"{self.round}_{col_name}" for _, col_name in indicators.items()}
            self.dataset.rename(columns=renamer, inplace=True)

        self._unique_code = unique_code
        return self.dataset

    @property
    def unique_code(self):
        return self._unique_code

    @cached_property
    def settlement_id(self):
        return detect_settlement_id_field(self.dataset)

    def cols_map(self):
        cols_map = {
            'coord_id': 'coord_id',
            'unique_code': self.unique_code,
            'settlement_id': self.settlement_id
        }

        if self.geom_cols.not_found:
            cols_map.pop('coord_id')

        if self.settlement_id is None:
            cols_map.pop('settlement_id')

        return cols_map


def evaluate_coverage(row: pd.Series, coverage_cols: list):
    coverages: list[str|None] = [row[col] for col in coverage_cols]
    matched_values: list[str] = [value for value in coverages if value not in ['Not Found', np.nan, None]]
    if not matched_values:
        return None

    matched_counter = dict(Counter(matched_values))
    return max(matched_counter, key=matched_counter.get)


def evaluate_settlement_coverage(data: pd.DataFrame):
    cols_check: list = [re.match(r'^final_.+?_coverage', col, re.IGNORECASE) for col in data.columns]
    coverage_cols: list[str] = [col.group(0) for col in cols_check if col]
    data['coverage'] = data.apply(evaluate_coverage, args=(coverage_cols,), axis=1)

    data.drop(columns=coverage_cols, inplace=True)

    return data


def evaluate_contact_prop(row: pd.Series, cols: list[str]) -> list[int, float|int]:
    values = [row.get(col) for col in cols]
    matched_values = [value for value in values if value in ['Visited', 'Not Visited']]
    if len(matched_values) == 0:
        return [0, 0]

    contacts = len([value for value in matched_values if value=='Visited'])
    contact_prop = round(contacts / len(matched_values), 2)
    return [contacts, contact_prop]


def evaluate_settlement_contacts(data: pd.DataFrame):
    cols_check: list = [re.match(r'^final_.+?_visitation', col, re.IGNORECASE) for col in data.columns]
    visitation_cols: list[str] = [col.group(0) for col in cols_check if col]
    data['res'] = data.apply(evaluate_contact_prop, args=(visitation_cols, ), axis=1)
    data['contact'] = data['res'].str[0]
    data['contact_proportion'] = data['res'].str[1]

    remapper = {col: col.replace('final_', '').replace('_visitation', '') for col in visitation_cols}
    data.rename(columns=remapper, inplace=True)
    data.drop(columns='res', inplace=True)

    return data


def create_dataset(data: pd.DataFrame, round_name: str) -> Dataset:
    geo_cols = GeomColumns.get_geom_cols(data, False)
    indicator_columns: IndicatorColumns | None = IndicatorColumns.create_from_data(data=data) if round_name != 'baseline' else None
    campaign_dict = {'round': round_name, 'dataset': data, 'geom_cols': geo_cols, 'state': 'Kebbi', 'indicators': indicator_columns}
    campaign_dataset: Dataset = Dataset(**campaign_dict)
    return campaign_dataset


def harmonize_visitation(row: pd.Series, visitation_cols: list[str]) -> str:
    visitation_values = [row[visitation_col] for visitation_col in visitation_cols]

    if pd.isna(visitation_values).all():
        return "Not Found"

    if any(list(filter(lambda x: x=="Visited", visitation_values))):
        return "Visited"

    return "Not Visited"


def harmonize_coverage(row: pd.Series, coverage_cols: list[str]):
    coverages = [row[cov_col] for cov_col in coverage_cols]

    if pd.isna(coverages).all():
        return "Not Found"

    if any(coverage=='Fully Covered' for coverage in coverages):
        return "Fully Covered"

    if any(coverage=='Partially Covered' for coverage in coverages):
        return "Partially Covered"

    if any(coverage=='Poorly Covered' for coverage in coverages):
        return "Poorly Covered"

    return "No Coverage"


def evaluate_contact(baseline_data: Dataset, comparative_data: Dataset):
    baseline_map_cols: dict[str, str] = baseline_data.cols_map()
    comparative_map_cols: dict[str, str] = comparative_data.cols_map()
    df = baseline_data.dataset.copy()
    df.reset_index(drop=False, inplace=True, names='id')
    indicators_values_cols = []
    for strategy, field_name in baseline_map_cols.items():
        if strategy not in comparative_map_cols:
            continue

        comp_table = comparative_data.dataset.copy()
        strategy_field = comparative_map_cols[strategy]
        indicators = list(comparative_data.indicators.indicators().values())
        indicator_mapping = {f"{comparative_data.round}_{ind}": f"{comparative_data.round}_{ind}_{strategy}" for ind in indicators}
        comp_table.rename(columns=indicator_mapping, inplace=True)
        columns = [strategy_field] + list(indicator_mapping.values())
        indicators_values_cols.extend(list(indicator_mapping.values()))
        df = df.merge(comp_table[columns], how='left', right_on=strategy_field, left_on=field_name)
        df.drop_duplicates(subset='id', keep='first', inplace=True)

    logging.info("Harmonizing Triangulation")
    df[f'final_{comparative_data.round}_visitation'] = df.apply(harmonize_visitation, args=(indicators_values_cols, ), axis=1)
    df[f'final_{comparative_data.round}_coverage'] = df.apply(harmonize_coverage, args=(indicators_values_cols, ), axis=1)

    logging.info('Cleaning up Table and Removing Unnecessary Fields')
    drop_cols = indicators_values_cols + ['id'] + [col for col in list(comparative_map_cols.values()) if col not in list(baseline_map_cols.values())]
    df.drop(columns=drop_cols, inplace=True, errors='ignore')
    baseline_data.dataset = df
    return baseline_data


async def execute_contact_analysis(baseline_settlements: pd.DataFrame, comparative_settlements: dict[str, pd.DataFrame]) -> pd.DataFrame:
    logging.info('Generating Datasets')
    baseline_dataset = create_dataset(baseline_settlements, 'baseline')
    previous_rounds_datasets = []

    for round_name, round_data in tqdm(comparative_settlements.items(), desc="Creating Datasets"):
        round_dataset = create_dataset(round_data, round_name)
        previous_rounds_datasets.append(round_dataset)
        logging.info(f"Triangulating Against {round_name} Data")
        baseline_dataset = evaluate_contact(baseline_dataset, round_dataset)

    processed_data = baseline_dataset.dataset.copy()
    logging.info('Calculating Contacts and Proportion of Visitation')
    processed_data = evaluate_settlement_contacts(processed_data)
    processed_data = evaluate_settlement_coverage(processed_data)
    processed_data.drop(columns=['coord_id'], inplace=True)
    return processed_data


if __name__ == '__main__':
    import openpyxl
    import asyncio
    baseline_settlement_file = r"C:\Workspace\MLoS\validation\Kebbi_Harmonised_MLoS_Manager.xlsx"
    baseline_df = pd.read_excel(baseline_settlement_file, sheet_name="state")
    baseline_df = baseline_df[
        ['settlement_id', 'unique_code', 'lga_name', 'ward_name', 'settlement_name', 'latitude', 'longitude']]

    previous_camp_file = r"C:\Workspace\DEV\Toolbox\src\dev\Contact Analysis 2026_test.xlsx"
    rounds = openpyxl.load_workbook(previous_camp_file).sheetnames
    campaign_datasets: dict[str, pd.DataFrame] = {}
    for camp_round in tqdm(rounds, total=len(rounds)):
        df = pd.read_excel(previous_camp_file, sheet_name=camp_round)
        campaign_datasets[camp_round] = df

    res = asyncio.run(execute_contact_analysis(baseline_df, campaign_datasets))
    res.to_csv(r'C:\Workspace\DEV\Toolbox\src\dev\contact_res.csv', index=False)



