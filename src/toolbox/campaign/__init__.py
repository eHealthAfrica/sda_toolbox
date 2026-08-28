import io
from dataclasses import dataclass, InitVar, field
from typing import Optional

import pandas as pd
import geopandas as gpd

from toolbox.mlos import detect_unique_admin_field, construct_new_unique, get_admin_col
from toolbox.models import CampaignDay, State


@dataclass
class CampaignDatasets:
    settlements: pd.DataFrame
    tracks: gpd.GeoDataFrame
    campaign_day: CampaignDay
    reports: io.BytesIO = None
    _unique_code: str = None

    def __post_init__(self):
        dip_unique_col = detect_unique_admin_field(self.settlements)
        if not dip_unique_col:
            print("No Unique settlement column detected in DIP. Creating")
            dip_unique_col = 'Unique_Name'
            dip_data = construct_new_unique(self.settlements, dip_unique_col)
            self.settlements = dip_data
        self._unique_code = dip_unique_col

    @property
    def unique_code(self):
        return self._unique_code


@dataclass
class CoverageDataSet:
    unique_code: str
    tracks: gpd.GeoDataFrame
    summary: pd.DataFrame
    voronoi: gpd.GeoDataFrame = None
    gridded: gpd.GeoDataFrame = None
