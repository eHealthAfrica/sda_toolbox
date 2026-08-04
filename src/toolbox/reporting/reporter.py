import os
import logging
from abc import abstractmethod, ABC
from dataclasses import dataclass
from typing import Protocol, Optional

import pandas as pd
from tqdm import tqdm
from plotly.graph_objs import Figure

from toolbox.models import Scheme
from toolbox.reporting.viz import stylize, make_bar_chart, make_stacked_bar_chart, make_pie_chart
from toolbox.reporting.prep import (
    generate_summary_data,
    generate_breakdown_data,
    retrieve_color_scheme,
    get_report_values
)


@dataclass
class Reporters:
    cumulative: str = None
    day: str = None


class Report(Protocol):
    @abstractmethod
    def generate_report(self) -> dict:
        """Generates Graphical Report"""
        pass


    @staticmethod
    def writer(report_output: dict[str, dict[str, Figure]], folder: str, **kwargs):
        """Writes generated report images to disk/memory"""
        pass


class DailyReport:
    def __init__(self, dataset: pd.DataFrame, reporters: Reporters, lga_col: str, ward_col: Optional[str]=None)->None:
        self.dataset = dataset
        self.reporters = reporters
        self.lga = lga_col
        self.ward_col = ward_col

    def generate_report(self) -> dict[str, dict[str, Figure]]:
        reports = {}
        if self.reporters.day:
            logging.info(f'Generating Report for {self.reporters.day}')
            day_lga_report = self.generate_lga_reports(self.reporters.day)
            day_summary_report = self.generate_summary_report(self.reporters.day)
            day_reports = {'summary': day_summary_report, 'breakdown': day_lga_report}
            reports['day'] = day_reports

        if self.reporters.cumulative:
            logging.info(f'Generating Report for {self.reporters.cumulative}')
            cumm_lga_report = self.generate_lga_reports(self.reporters.cumulative)
            cumm_summary_report = self.generate_summary_report(self.reporters.cumulative)
            cumulative_reports = {'summary': cumm_summary_report, 'breakdown': cumm_lga_report}
            reports['cumulative'] = cumulative_reports

        return reports

    def generate_summary_report(self, report_col: str):
        report_values = get_report_values(self.dataset, report_col, True)
        report_values = ['Planned'] + report_values
        color_map = retrieve_color_scheme(report_values, Scheme.VISITATION)
        summary_report_data = generate_summary_data(self.dataset, report_col)
        summary_report_data.loc[-1] = ['Planned', summary_report_data['count'].sum()]
        summary_report_data.index = summary_report_data.index + 1
        summary_report_data.sort_index(inplace=True)

        chart_report: Figure =  make_bar_chart(summary_report_data, report_col, 'count', color_map, color=report_col, width=800)
        chart_report: Figure = stylize(chart_report)
        chart_report.write_image(
            rf'C:\Users\richa\Downloads\{report_col}_summary.png')
        return chart_report

    def generate_lga_reports(self, report_col: str):
        report_values = get_report_values(self.dataset, report_col, True)
        report_values = ['Planned'] + report_values
        color_map = retrieve_color_scheme(report_values, Scheme.VISITATION)
        lga_report_data = generate_breakdown_data(self.dataset, self.lga, report_col)
        lga_report_data['Planned'] = lga_report_data.sum(axis=1, numeric_only=True)
        lga_report_data.reset_index(drop=False, inplace=True)

        report_chart: Figure = make_bar_chart(
            lga_report_data, self.lga, report_values, color_scheme=color_map,
            barmode='group', width=10, text=True
        )

        report_chart: Figure = stylize(report_chart, True, group_gap=0.4, width=0.4)
        report_chart.write_image(
            rf'C:\Users\richa\Downloads\{report_col}_breakdown.png')

        return report_chart

    @staticmethod
    def writer(report_output: dict[str, dict[str, Figure]], folder: str,**kwargs)->None:
        report_day: int = kwargs.get('report_day')
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
    def __init__(self, data: pd.DataFrame, reporters: Reporters, lga_col: str, ward_col: str):
        self.data = data
        self.visitation_col = reporters.cumulative
        self.lga_col: str = lga_col
        self.ward_col: str = ward_col

    def generate_report(self) -> dict[str, dict[str, Figure]]:
        ward_reports: dict[str, Figure] = self.generate_ward_reports()
        lga_reports: dict[str, Figure] = self.generate_lga_reports()
        reports =  {'ward_reports': ward_reports, 'lga_reports': lga_reports}
        return reports

    def generate_ward_reports(self) -> dict[str, Figure]:
        ward_reports: dict[str, Figure] = {}
        lgas = self.data[self.lga_col].unique().tolist()
        for lga in tqdm(lgas, desc='Generating Ward Level Reports'):
            lga_data = self.data[self.data[self.lga_col]==lga]
            report_table = generate_breakdown_data(lga_data, self.ward_col, self.visitation_col)
            report_table.reset_index(inplace=True)
            report_values = get_report_values(lga_data, self.visitation_col, sort=True)
            color_map = retrieve_color_scheme(report_values, Scheme.VISITATION)
            report_table  = report_table.loc[:, [self.ward_col]+report_values]
            ward_report: Figure = make_stacked_bar_chart(report_table, report_values, color_map, self.ward_col)
            ward_report.write_image(f'C:\\WORKSPACE\\NIPDS\\JUNE_2025_NIPDS\\REPORTS\\{lga}_ward_post_implementation_report.png')
            ward_reports[lga] = ward_report

        return ward_reports

    def generate_lga_reports(self) -> dict[str, Figure]:
        lga_reports: dict[str, Figure] = {}
        lgas = self.data[self.lga_col].unique().tolist()

        for lga in tqdm(lgas, desc='Generating LGA Level Reports'):
            lga_data = self.data[self.data[self.lga_col]==lga]
            report_table = generate_summary_data(lga_data, self.visitation_col)
            report_values = get_report_values(lga_data, self.visitation_col, False)
            color_map = retrieve_color_scheme(report_values, Scheme.VISITATION)
            lga_report: Figure = make_pie_chart(
                report_table, self.visitation_col, 'count', color_map, color=self.visitation_col, hole=0.5)

            lga_report: Figure = stylize(lga_report)
            # lga_report.write_image(
            #     f'C:\\WORKSPACE\\NIPDS\\JUNE_2025_NIPDS\\REPORTS\\{lga}_post_implementation_report.png')
            lga_reports[lga] = lga_report

        return lga_reports

    @staticmethod
    def writer(report_output: dict, folder, lga_list: list):
        import concurrent.futures
        from tqdm import tqdm

        def write_lga_charts(lga):
            lga_report = report_output['lga_reports'][lga]
            lga_ward_report = report_output['ward_reports'][lga]

            lga_report.write_image(os.path.join(folder, f'{lga} Summary Report.png'))
            lga_ward_report.write_image(os.path.join(folder, f'{lga} Breakdown Report.png'))

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            image_futures = [executor.submit(write_lga_charts, lga) for lga in lga_list]
            for future in tqdm(
                    concurrent.futures.as_completed(image_futures),
                    desc='Writing Images', total=len(lga_list)):

                future.result()


if __name__ == '__main__':
    data = pd.read_csv(r"C:\Users\richa\Downloads\Final Results.csv")
    reporter = Reporters(day='Day 4', cumulative='day_4_cumm')
    report: Report = DailyReport(data, reporters=reporter, lga_col='lga_name', ward_col='ward')
    report.generate_report()
