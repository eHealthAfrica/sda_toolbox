import logging

import geopandas as gpd

from toolbox.utils import atimer
from toolbox.utils.offload import run_heavy
from toolbox.configs import CONFIG
from toolbox.target_area.v1.voronoi import fallback_voronoi
from toolbox.target_area.v1.gridded import fallback_grids
from toolbox.spatial_mgr.spatial_ops import SpatialOps


def _generate_buffer_target_area(planned_settlement: gpd.GeoDataFrame, distance: int) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """
    Generates a Buffer-based target area for planned settlements
    Parameters
    ----------
    planned_settlement gpd.GeoDataFrame: Planned Settlement list
    distance (int): Settlement buffer catchment

    Returns
    -------

    """
    logging.info('Generating Buffer-based Target Area')
    epsg_code = CONFIG['PRJ_EPSG']
    SpatialOps.check_and_match_projection(planned_settlement, crs_code=epsg_code)

    planned_settlement = planned_settlement.loc[
        (planned_settlement.geometry.x.notnull()) &
        (planned_settlement.geometry.x!=0)
    ]

    logging.info(f'Using Fallback Methodology to Generate Voronoi with a distance of {distance}')
    buffer_voronoi = fallback_voronoi(planned_settlement, distance=distance)
    buffer_voronoi['type'] = 'DEFAULT'

    logging.info(f'Generating Gridded TA')
    buffer_gridded_ta = fallback_grids(buffer_voronoi)
    buffer_voronoi.to_crs(inplace=True, epsg=4326)
    buffer_gridded_ta.to_crs(inplace=True, epsg=4326)

    return buffer_voronoi, buffer_gridded_ta


@atimer(display=True)
async def generate_buffer_target_area(planned_settlement: gpd.GeoDataFrame, distance: int) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """Generates a Buffer-based target area for planned settlements (runs in a worker thread: hardening H7)."""
    return await run_heavy(_generate_buffer_target_area, planned_settlement, distance)


if __name__ == '__main__':
    import asyncio
    from toolbox.spatial_mgr.spatial_ops import convert_to_geodata
    import pandas as pd
    df = pd.read_csv()