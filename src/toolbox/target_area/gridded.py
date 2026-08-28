from dataclasses import dataclass
from typing import Literal
import logging

import geopandas as gpd
import pandas as pd

from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.spatial_mgr import SpatialOps
from toolbox.target_area import create_grid_cells, grid_reviewer


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
            msg = f"⚠️ {self.unique_gridded:,} settlements have grid cells compared to the {self.unique_voronoi:,} total settlements"
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
    gridded_ta['building_count'] = 0
    if gridded_ta.empty and building_fp.empty:
        return gridded_ta

    join = gpd.sjoin(
        building_fp[["geometry"]],
        gridded_ta[["row_id", "geometry"]],
        predicate="within"
    )

    counts = join.groupby("row_id").size()
    gridded_ta["building_count"] = gridded_ta["row_id"].map(counts).fillna(0).astype(int)
    return gridded_ta


def create_ta_grids(voronoi: gpd.GeoDataFrame, profile: Literal['BUA', 'DEFAULT']):
    grids: dict[str, int] = {
        "BUA": 50,
        "DEFAULT": 100
    }

    size = grids.get(profile)
    voronoi_bounds = voronoi.total_bounds.tolist()
    state_grid = create_grid_cells(voronoi_bounds, size, voronoi.crs)
    logging.info(f"Total {size}m Grid Cells: {len(state_grid):,}")

    overlapping_grids: gpd.GeoDataFrame = state_grid.overlay(voronoi, how="intersection")
    overlapping_grids.insert(0, "row_id", overlapping_grids.index+1, allow_duplicates=False)
    overlapping_grids['area_sqm'] = overlapping_grids.geometry.area
    overlapping_grids = overlapping_grids.loc[overlapping_grids['area_sqm'] > int(CONFIG['AREA_LIMIT'])]
    logging.info(f"Total Overlapping {size}m by {size}m Grid Cells: {len(overlapping_grids):,}")

    return overlapping_grids


def review_grids(state_grids: gpd.GeoDataFrame, unique_col: str):
    """Review Grid Cells against building count based on threshold"""
    building_count_limit = CONFIG['BUILDING_LIMIT']
    state_grids['status'] = state_grids.apply(grid_reviewer, args=(building_count_limit,), axis=1)

    reviewed_grids = []
    for _, grid_group in state_grids.groupby(unique_col):
        droppable_grids = grid_group.loc[grid_group["status"].notnull()]
        if len(droppable_grids) == len(grid_group):
            reviewed_grids.append(grid_group)

        else:
            droppable_indexes = droppable_grids.index.tolist()
            passed_grid_group = grid_group.loc[~grid_group.index.isin(droppable_indexes)]
            reviewed_grids.append(passed_grid_group)

    approved_grids: gpd.GeoDataFrame =  pd.concat(reviewed_grids, ignore_index=True)
    approved_grids.drop(columns=["status"], inplace=True)

    logging.info(f"Total Grids that Overlap Buildings: {len(approved_grids):,}")
    return approved_grids


@timer
def build_settlement_grids(state_voronoi: gpd.GeoDataFrame, footprint: gpd.GeoDataFrame, unique_col: str)-> gpd.GeoDataFrame:

    default_ta: gpd.GeoDataFrame = state_voronoi.loc[state_voronoi["type"] != "Built-up Area"]
    built_up_ta: gpd.GeoDataFrame = state_voronoi.loc[state_voronoi["type"] == "Built-up Area"]

    logging.info("Generating Grids...")
    default_grids: gpd.GeoDataFrame = create_ta_grids(default_ta, 'DEFAULT')
    built_up_grids: gpd.GeoDataFrame = create_ta_grids(built_up_ta, 'BUA')

    gridded_ta = pd.concat([built_up_grids, default_grids], ignore_index=True)
    logging.info(f"Total Grids Cells for State:  {len(gridded_ta):,}")

    logging.info("Enrich with building Building Footprint")
    enriched_grids = enrich_with_building_fp(gridded_ta, footprint)
    enriched_grids = review_grids(enriched_grids, unique_col)

    ta_validation: TAValidation = TAValidation.validate_ta_settlements(state_voronoi, enriched_grids, unique_col)
    ta_validation.response()

    return enriched_grids


if __name__ == '__main__':
    from toolbox.access import ReadDBData
    fp_data = ReadDBData('building_fp', True).read_data({'statename': ['Sokoto']})
    fp_data.to_crs(32631, inplace=True)
    ta_layer = gpd.read_file(r"C:\Workspace\DEV\Toolbox\src\dev\sokoto.gpkg", driver="GPKG", layer='settlement_voronoi')
    final_ta = build_settlement_grids(ta_layer, fp_data, 'unique_code')
    final_ta.to_file(r"C:\Workspace\DEV\Toolbox\src\dev\ta.gpkg", driver="GPKG", layer="final_ta")
