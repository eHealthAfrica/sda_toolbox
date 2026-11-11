import logging

import pandas as pd
from fastapi import UploadFile

from toolbox.access.read_mgr import read_dataset
from toolbox.campaign.visitation_analysis import update_dip_data
from toolbox.campaign import CampaignDatasets, CoverageDataSet
from toolbox.campaign.campaign_tools import classify_results
from toolbox.campaign.grids import assess_grid_visitation
from toolbox.reporting import DailyReport, PostReport
from toolbox.models import State, CampaignDay, Extensions
from toolbox.configs import CONFIG
from toolbox.tracks_manager.tr import read_tracks
from toolbox.utils import atimer
from toolbox.utils.offload import run_heavy


def prepare_reports(dip_data: pd.DataFrame, day_col: str) -> list[PostReport]:

    daily_reports = DailyReport(
        dip_data,
        coverage_col='Settlement Coverage',
       campaign_day_col=day_col,
    )

    reports = daily_reports.generate_report()
    return reports


# async def prepare_datasets(
#         settlement_file: UploadFile, tracks_file: UploadFile,
#         extension: Extensions, day: int, mop_up: bool) -> CampaignDatasets:
#
#     dip_data = await read_dataset(settlement_file)
#     extension = extension.value if extension else None
#     tracks_data: gpd.GeoDataFrame = await read_tracks(tracks_file, extension)
#
#     campaign_day = CampaignDay(analysis_day=day, is_mop_up=mop_up)
#     datasets = CampaignDatasets(dip_data, tracks_data, campaign_day)
#
#     return datasets


def _track_settlements(
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
        report_buffer = prepare_reports(updated_dip_data, day_col)
        campaign_datasets.reports = report_buffer

    return campaign_datasets


@atimer(title="Gridded Settlement Visitation Analysis", display=True)
async def settlement_tracking(
        campaign_datasets: CampaignDatasets,
        state: State | list[State],
        generate_report: bool=True) -> CampaignDatasets:
    """Tracks settlement visitation using GPS tracks (see _track_settlements for the parameters).

    The analysis is heavy pandas/geopandas work, so it runs in a worker thread: on the event loop it
    would freeze every other request, /health included, until it finished (hardening H7)."""
    return await run_heavy(_track_settlements, campaign_datasets, state, generate_report)


if __name__ == '__main__':
    import geopandas as gpd
    import asyncio

    folder = "C:\\Workspace\\NEOC\\MIGRANT MAPPING\\SEPTEMEBR ROUND"
    dip = pd.read_csv(f'{folder}\\September2026_Migrant_Sites.csv')

    tracks = gpd.read_file(f'{folder}\\GIS\\tracks.gpkg', driver='GPKG')
    day = 5 #int(input('Enter Analysis Day: '))

    datasets = CampaignDatasets(
        settlements=dip,
        tracks=tracks,
        campaign_day=CampaignDay(analysis_day=day, is_mop_up=True)
    )
    states = dip['STATE'].unique().tolist()
    result = asyncio.run(
        settlement_tracking(
            datasets,
            [State[state] for state in states],
            generate_report=False
        )
    )

    print('The End')
