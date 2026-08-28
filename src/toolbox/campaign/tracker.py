import logging
import io

import pandas as pd

from toolbox.campaign.visitation_analysis import update_dip_data
from toolbox.campaign import CampaignDatasets, CoverageDataSet
from toolbox.campaign.campaign_tools import classify_results
from toolbox.campaign.grids import assess_grid_visitation
from toolbox.reporting import DailyReport
from toolbox.models import State, CampaignDay
from toolbox.tools import write_in_memory_zip
from toolbox.mlos import get_admin_col
from toolbox.configs import CONFIG
from toolbox.utils import atimer


def prepare_reports(dip_data: pd.DataFrame, analysis_day: int, day_col: str) -> list:

    daily_reports = DailyReport(
        dip_data,
        coverage_col='',
       campaign_day_col=day_col,
    )

    reports = daily_reports.generate_report()
    return reports
    # zip_buffer = write_in_memory_zip(
    #     daily_reports,
    #     reports,
    #     analysis_day
    # )
    #
    # return zip_buffer


@atimer(title="Gridded Settlement Visitation Analysis", display=True)
async def settlement_tracking(
        campaign_datasets: CampaignDatasets,
        state: State | list[State],
        generate_report: bool=True) -> CampaignDatasets:

    """Tracks settlement visitation using GPS tracks

    Parameters:
        campaign_datasets (CampaignDatasets): Settlement, TA and tracks data
        state (State): State information
        generate_report: bool, optional): Whether to generate a summary report. Defaults to True.

    Raises:
        NoRecordsFound: Raised when no records are found after filtering valid tracks

    Returns:
        pd.DataFrame: Updated campaign settlements with visitation status

    """

    print('Finding Visited Settlement Grids and Generating Summary...')
    coverage_dataset: CoverageDataSet = assess_grid_visitation(
        campaign_datasets.tracks,
        state
    )

    print('Updating Settlement List and Classifying Results...')
    updated_dip_data, day_col = update_dip_data(
        campaign_datasets,
        coverage_dataset.summary,
        coverage_dataset.unique_code
    )

    updated_dip_data = classify_results(updated_dip_data)
    logging.info('Removing Unnecessary Columns')
    col_to_drop = CONFIG.get('DROPPING').get('H2H')
    updated_dip_data.drop(columns=col_to_drop, inplace=True, errors='ignore')
    logging.info(f'Completed Visitation Operation for Campaign Day {campaign_datasets.campaign_day.analysis_day}')

    campaign_datasets.settlements = updated_dip_data
    campaign_datasets.tracks = coverage_dataset.tracks

    if generate_report:
        print(f'Generating Reports for {campaign_datasets.campaign_day.analysis_day}...')
        report_buffer = prepare_reports(updated_dip_data, campaign_datasets.campaign_day.analysis_day, day_col)
        campaign_datasets.reports = report_buffer

    return campaign_datasets


if __name__ == '__main__':
    import geopandas as gpd
    import asyncio
    import io

    folder = "C:\\Workspace\\NEOC\\IBRA\\August Round"
    dip = pd.read_csv(f'{folder}\\Compiled IBRA R2 Settlements.csv')

    tracks = gpd.read_file(f'{folder}\\GIS\\tracks_day_6.gpkg', driver='GPKG')
    day = 6  #int(input('Enter Analysis Day: '))

    datasets = CampaignDatasets(
        settlements=dip,
        tracks=tracks,
        campaign_day=CampaignDay(analysis_day=day, is_mop_up=True)
    )
    states = ['Adamawa',
     'Bauchi',
     'Borno',
     'Gombe',
     'Jigawa',
     'Kaduna',
     'Kano',
     'Katsina',
     'Kebbi',
     'Kwara',
     'Nasarawa',
     'Niger',
     'Sokoto',
     'Yobe',
     'Zamfara']
    result = asyncio.run(
        settlement_tracking(
            datasets,
            [State[state] for state in states],
            generate_report=False
        )
    )

    print('The End')
