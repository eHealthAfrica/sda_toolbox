from dataclasses import dataclass
from typing import Literal
import logging

import geopandas as gpd
from tqdm import tqdm
import numpy as np
import pandas as pd

from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.spatial_mgr import SpatialOps
from toolbox.exceptions import NoRecordsFound
from toolbox.target_area import fallback_grids, review_grids_by_building_class, cleanup_grids


@dataclass
class TAValidation:
    total_voronoi: int
    total_gridded: int
    unique_voronoi: int
    unique_gridded: int
    is_consistent: bool

    def response(self):
        if self.is_consistent:
            msg = "Settlements are consistent between the gridded TA and Voronoi"
            logging.info(msg)

        else:
            msg = f"{self.unique_gridded:,} settlements have grid cells compared to the {self.unique_voronoi:,} total settlements"
            logging.warning(msg)

    @classmethod
    def validate_ta_settlements(
            cls, ta_voronoi: gpd.GeoDataFrame, ta_grids: gpd.GeoDataFrame, unique_col: str) -> "TAValidation":

        unique_voronoi_settlements = ta_voronoi[unique_col].unique().tolist()
        unique_ta_settlements = ta_grids[unique_col].unique().tolist()
        consistency = len(unique_voronoi_settlements) == len(unique_ta_settlements)

        return TAValidation(
            len(ta_voronoi),
            len(ta_grids),
            len(unique_voronoi_settlements),
            len(unique_ta_settlements),
            consistency
        )


def enrich_with_building_fp(gridded_ta: gpd.GeoDataFrame, building_fp: gpd.GeoDataFrame):
    """Extracts No of Buildings for each grid cell"""

    SpatialOps.check_and_match_projection(building_fp, gridded_ta)
    logging.info(f"Extracting Buildings for each grid cell")
    # gridded_ta['building_count'] = 0
    if gridded_ta.empty and building_fp.empty:
        return gridded_ta

    join = gpd.sjoin(
        building_fp[["geometry", "building_type", "weight"]],
        gridded_ta[["rowid", "geometry"]],
        predicate="intersects"
    )

    bd_counts = join.groupby("rowid").agg({'rowid': 'count', 'weight': 'mean'}).round({'weight': 0}).rename(columns={'rowid': 'building_count'})
    bd_counts['weight'] = bd_counts['weight'].fillna(1)
    bd_types = join.groupby(by=['rowid', 'building_type']).size().unstack().fillna(0).astype(int)
    gridded_ta = gridded_ta.merge(bd_counts, how='left', left_on='rowid', right_index=True)
    gridded_ta = gridded_ta.merge(bd_types, how='left', left_on='rowid', right_index=True)
    return gridded_ta


def prepare_ta_grids(voronoi: gpd.GeoDataFrame, profile: Literal['BUA', 'NON-BUA'], grids: gpd.GeoDataFrame):
    grids_cats: dict[str, list] = {
        "BUA": ['Built-up Area'],
        "NON-BUA": ['Hamlet', 'Small Settlement Area', 'DEFAULT', np.nan, None]
    }
    SpatialOps.check_and_match_projection(grids, voronoi)
    profile_types = grids_cats[profile]
    profile_grids = grids.loc[grids['type'].isin(profile_types)]
    overlapping_grids: gpd.GeoDataFrame = profile_grids.overlay(voronoi, how="intersection")
    overlapping_grids['area_sqm'] = overlapping_grids.area
    overlapping_grids = overlapping_grids.loc[overlapping_grids['area_sqm'] > int(CONFIG['AREA_LIMIT'])]
    logging.info(f"Total Overlapping Cells for {profile} Settlement Type: {len(overlapping_grids):,}")

    return overlapping_grids


def review_grids(state_grids: gpd.GeoDataFrame, unique_col: str):
    """Review Grid Cells against building count based on threshold"""
    reviewed_grids = []
    for _, grid_group in tqdm(state_grids.groupby(unique_col), desc='Assessing Each Settlement Grids', unit=' Settlements'):
        assessed_grids = review_grids_by_building_class(grid_group)
        reviewed_grids.append(assessed_grids)

    approved_grids: gpd.GeoDataFrame =  pd.concat(reviewed_grids, ignore_index=True)
    approved_grids.sort_values(by=[unique_col, 'rowid', 'building_count'], ascending=True, inplace=True)
    approved_grids.drop_duplicates(subset=['rowid'], inplace=True)
    approved_grids.drop(columns=["status"], inplace=True)

    logging.info(f"Total Grids that Overlap Buildings: {len(approved_grids):,}")
    return approved_grids


@timer
def build_settlement_grids(state_voronoi: gpd.GeoDataFrame, footprint: gpd.GeoDataFrame, grids: gpd.GeoDataFrame, unique_col: str)-> gpd.GeoDataFrame:

    logging.info("Generating Grids...")
    default_grids: gpd.GeoDataFrame = prepare_ta_grids(state_voronoi, 'NON-BUA', grids)
    built_up_grids: gpd.GeoDataFrame = prepare_ta_grids(state_voronoi, 'BUA', grids)

    gridded_ta = pd.concat([built_up_grids, default_grids], ignore_index=True)
    generated_grids = gridded_ta[unique_col].unique().tolist()
    voronoi_missing_grids = state_voronoi.loc[~state_voronoi[unique_col].isin(generated_grids)]
    if not voronoi_missing_grids.empty:
        missing_grids = fallback_grids(voronoi_missing_grids, max(gridded_ta['rowid']))
        gridded_ta = pd.concat([gridded_ta, missing_grids], ignore_index=True)

    if gridded_ta.empty:
        raise NoRecordsFound('Empty Data', 'No Grids were generated')

    logging.info(f"Total Grids Cells for State:  {len(gridded_ta):,}")

    logging.info("Enrich with building Building Footprint")
    enriched_grids = enrich_with_building_fp(gridded_ta, footprint)
    reviewed_grids = review_grids(enriched_grids, unique_col)
    cleaned_grids = cleanup_grids(reviewed_grids)
    cleaned_grids['weight'] = cleaned_grids['weight'].fillna(1)
    ta_validation: TAValidation = TAValidation.validate_ta_settlements(state_voronoi, cleaned_grids, unique_col)
    ta_validation.response()

    return cleaned_grids


if __name__ == '__main__':
    from toolbox.access import ReadDBData
    fp_data = ReadDBData('building_fp', True).read_data({'statename': ['Sokoto']})
    grids_data = ReadDBData('grids', True).read_data({'statename': ['Sokoto']})
    fp_data.to_crs(32631, inplace=True)
    ta_layer = gpd.read_file(r"C:\Workspace\DEV\Toolbox\src\dev\sokoto.gpkg", driver="GPKG", layer='settlement_voronoi')
    final_ta = build_settlement_grids(ta_layer, fp_data, grids_data, 'unique_code')
    final_ta.to_file(r"C:\Workspace\DEV\Toolbox\src\dev\sokoto_ta.gpkg", driver="GPKG", layer="final_ta")
