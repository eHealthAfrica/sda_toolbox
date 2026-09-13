import os
import re
import json
import logging
from abc import abstractmethod
from typing import Protocol, Literal, Any, Optional

import pandas as pd
from tqdm import tqdm
from plotly.graph_objs import Figure
from pydantic import BaseModel, ConfigDict, field_serializer

from toolbox.models import Scheme
from toolbox.reporting.viz import stylize, make_bar_chart, make_pie_chart
from toolbox.reporting.prep import (
    generate_summary_data,
    generate_breakdown_data,
    retrieve_color_scheme,
    get_report_values, order_scheme_values
)


class PostReport(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    state: str
    lga: Optional[str]
    level: Literal['state', 'lga', 'ward']
    figure: Figure
    save_name: str

    @field_serializer('figure')
    def serialize_figure(self, figure: Figure) -> dict:
        return json.loads(figure.to_json())


class Report(Protocol):
    @abstractmethod
    def generate_report(self) -> list:
        """Generates Graphical Report"""
        pass


    @staticmethod
    def writer(report_output: dict[str, dict[str, Figure]], folder: str, **kwargs):
        """Writes generated report images to disk/memory"""
        pass


#Todo: Need Rework
class DailyReport:
    def __init__(self, dataset: pd.DataFrame, coverage_col: str, campaign_day_col: str)->None:
        from toolbox.mlos import AdminColumns
        self.dataset = dataset
        self.coverage_col = coverage_col
        self.campaign_day = campaign_day_col
        self.admin = AdminColumns.create_by_search(self.dataset)
        self.day_value: str = re.search(r'\d+', self.campaign_day, re.IGNORECASE).group(0)

    def generate_report(self) -> list[PostReport]:
        logging.info(f'Generating Report for Day {self.day_value}')
        day_lga_report = self.generate_lga_reports(True)
        day_summary_report = self.generate_summary_report(True)

        logging.info(f'Generating Cumulative Report for {self.day_value}')
        cumm_lga_report = self.generate_lga_reports(False)
        cumm_summary_report = self.generate_summary_report(False)

        day_reports = day_lga_report + day_summary_report + cumm_lga_report + cumm_summary_report
        return day_reports

        return reports

    def generate_summary_report(self, subset: bool) -> list[PostReport]:
        qualifier = 'Cumulative'
        data = self.dataset.copy()
        if subset:
            qualifier = 'Daily'
            data = data.loc[data[self.campaign_day].notnull()]

        summary_reports: list[PostReport] = []
        states: list[str] = data[self.admin.state].unique().tolist()
        for state in states:
            state_lga_data = data.loc[data[self.admin.state]==state]
            report_values = get_report_values(state_lga_data, self.coverage_col, True)
            color_map = retrieve_color_scheme(report_values, Scheme.COVERAGE)

            summary_report_data = generate_summary_data(state_lga_data, self.coverage_col).fillna(0)

            summary_report_data.index = summary_report_data.index + 1
            summary_report_data.sort_index(inplace=True)

            chart_report: Figure =  make_pie_chart(
                summary_report_data, self.coverage_col, 'count', color_map, color=self.coverage_col, hole=0.5)

            chart_report: Figure = stylize(chart_report)
            out_name = f'{state} State Day {self.day_value} {qualifier} Summary .png'
            summary_report = PostReport(
                state=state,
                lga=None,
                level='state',
                figure=chart_report,
                save_name=out_name
            )

            summary_reports.append(summary_report)

        return summary_reports

    def generate_lga_reports(self, subset: bool) -> list[PostReport]:
        qualifier = 'Cumulative'
        data = self.dataset.copy()
        if subset:
            qualifier = 'Daily'
            data = data.loc[data[self.campaign_day].notnull()]

        breakdown_charts: list[PostReport] = []
        states: list[str] = data[self.admin.state].unique().tolist()
        for state in tqdm(states, desc=f'Creating Day {self.day_value} LGA Reports'):
            state_data = data.loc[data[self.admin.state]==state]
            report_values = get_report_values(state_data, self.coverage_col, True)
            color_map = retrieve_color_scheme(report_values, Scheme.COVERAGE)
            ordered_report_values = order_scheme_values(color_map, Scheme.COVERAGE)
            lga_report_data = generate_breakdown_data(state_data, self.admin.lga, self.coverage_col).fillna(0).reset_index(names=self.admin.lga)
            lga_report_data = lga_report_data[[self.admin.lga]+ordered_report_values]

            report_chart: Figure = make_bar_chart(
                lga_report_data, self.admin.lga, ordered_report_values, color_scheme=color_map
            )

            report_chart: Figure = stylize(report_chart, True, group_gap=0.4, width=0.9)
            out_name = f'{state} State Day {self.day_value} {qualifier} Breakdown Report.png'
            summary_report = PostReport(
                state=state,
                lga=None,
                level='lga',
                figure=report_chart,
                save_name=out_name
            )

            breakdown_charts.append(summary_report)

        return breakdown_charts

    @staticmethod
    def writer(report_output: dict[str, dict[str, Figure]], folder: str, **kwargs)->None:
        report_day: Any = kwargs.get('report_day')
        if report_output['day']:
            logging.info(f'Writing Day Reports for {report_day}')
            summary_report: Figure = report_output['day']['summary']
            summary_report.write_image(os.path.join(folder, f'Day {report_day} Summary Report.png'))
            breakdown_report = report_output['day']['breakdown']
            breakdown_report.write_image(os.path.join(folder, f'Day {report_day} LGA Report.png'))

        if report_output['cumulative']:
            logging.info(f'Writing Cumulative Reports for {report_day}')
            summary_report: Figure = report_output['cumulative']['summary']
            summary_report.write_image(os.path.join(folder, f'Day {report_day} Cumulative Summary Report.png'))
            breakdown_report = report_output['cumulative']['breakdown']
            breakdown_report.write_image(os.path.join(folder, f'Day {report_day} Cumulative LGA Report.png'))


class PostImplementationReport:
    def __init__(self, data: pd.DataFrame, coverage_column: str):
        from toolbox.mlos import AdminColumns
        self.data = data
        self.coverage_col: str = coverage_column
        self.admin = AdminColumns.create_by_search(self.data)

    def generate_report(self) -> list[PostReport]:
        ward_reports: list[PostReport] = self.generate_ward_reports()
        lga_reports: list[PostReport] = self.generate_lga_reports()
        return lga_reports + ward_reports

    def generate_ward_reports(self) -> list[PostReport]:
        ward_reports: list[PostReport] = []
        lgas: list[str] = self.data['lga_code'].unique().tolist()
        dataset = self.data.copy()
        for lga in tqdm(lgas, desc='Generating Ward Level Reports'):
            state_name, lga_name = lga.split('_')
            state_name, lga_name = state_name.title(), lga_name.title()
            lga_data = dataset.loc[self.data['lga_code']==lga]
            report_table = generate_breakdown_data(lga_data, self.admin.ward, self.coverage_col)
            report_table.reset_index(inplace=True)
            report_values = get_report_values(lga_data, self.coverage_col, sort=True)
            color_map: dict = retrieve_color_scheme(report_values, Scheme.COVERAGE)
            values_order = order_scheme_values(color_map, Scheme.COVERAGE)
            report_table  = report_table.loc[:, [self.admin.ward]+ values_order].fillna(0)
            ward_report: Figure = make_bar_chart(report_table, self.admin.ward, values_order, color_map)
            ward_report = stylize(ward_report, True, group_gap=0, width=0.8)
            save_name = f'{state_name.title()} State, {lga_name.title()} LGA, Ward Level PI Report.png'
            ward_reports.append(
                PostReport(
                    state=state_name,
                    lga=lga_name,
                    level='ward',
                    figure=ward_report,
                    save_name=save_name
                )
            )

        return ward_reports

    def generate_lga_reports(self) -> list[PostReport]:
        lga_reports: list[PostReport] = []
        lgas: list[str] = self.data['lga_code'].unique().tolist()

        for lga in tqdm(lgas, desc='Generating LGA Level Reports'):
            state_name, lga_name = lga.split('_')
            state_name, lga_name = state_name.title(), lga_name.title()
            lga_data = self.data[self.data['lga_code']==lga]
            report_table = generate_summary_data(lga_data, self.coverage_col).fillna(0)
            report_values = get_report_values(lga_data, self.coverage_col, False)
            color_map = retrieve_color_scheme(report_values, Scheme.COVERAGE)
            lga_report: Figure = make_pie_chart(
                report_table, self.coverage_col, 'count', color_map, color=self.coverage_col, hole=0.5)

            lga_report: Figure = stylize(lga_report)
            save_name = f'{state_name} State, {lga_name} LGA,  LGA Summary PI REPORT.png'
            lga_reports.append(
                PostReport(
                    state=state_name,
                    lga=lga_name,
                    level='lga',
                    figure=lga_report,
                    save_name=save_name
                )
            )

        return lga_reports

    @staticmethod
    def writer(report_output: dict[str, dict[str, Figure]], folder: str, **kwargs):
        import concurrent.futures
        from tqdm import tqdm
        lga_list = kwargs['lga_list']
        def write_lga_charts(lga):
            state_name, lga_name = lga.split('_')
            lga_report = report_output['lga_reports'][lga]
            lga_ward_report = report_output['ward_reports'][lga]

            lga_report.write_image(os.path.join(folder, f'{state_name} State {lga_name} LGA_Summary Report.png'))
            lga_ward_report.write_image(os.path.join(folder, f'{state_name} State {lga_name} LGA_Ward Breakdown Report.png'))

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            image_futures = [executor.submit(write_lga_charts, lga) for lga in lga_list]
            for future in tqdm(
                    concurrent.futures.as_completed(image_futures),
                    desc='Writing Images', total=len(lga_list)):

                future.result()


if __name__ == '__main__':
    df = pd.read_csv(r"C:\Workspace\NEOC\IBRA\August Round\Compiled IBRA R2 Settlements.csv")
    # df['lga_code'] = df.apply(lambda row: f"{row['state']}_{row['lga']}", axis=1)
    report: Report = DailyReport(df, coverage_col='Settlement Coverage', campaign_day_col='day_6')
    report.generate_report()
