import logging

from tqdm import tqdm
import pandas as pd

from toolbox.configs import CONFIG
from toolbox.exceptions import DataError
from toolbox.triangulate.ttools import set_reach
from toolbox.spatial_mgr import SpatialOps, convert_to_geodata, GeomColumns


def triangulate_by_location(
        settlement_list: pd.DataFrame, submission_datasets: dict[str, pd.DataFrame], unique_col: str):
    logging.info('Intersecting Supplementary Data against Settlement list')

    projected_epsg = CONFIG['PRJ_EPSG']
    geo_cols = GeomColumns.get_geom_cols(settlement_list, True)
    settlement_list = convert_to_geodata(settlement_list, geo_cols)
    SpatialOps.check_and_match_projection(settlement_list, crs_code=projected_epsg)
    settlement_with_geom = settlement_list.loc[
        (settlement_list[geo_cols.latitude].notna())
        & (settlement_list[geo_cols.longitude].notna())
    ]
    with_geom_idx = settlement_with_geom.index.tolist()
    settlement_no_geom = settlement_list.loc[~settlement_list.index.isin(with_geom_idx)]
    for source_name, data in tqdm(submission_datasets.items(), desc='By Coords', total=len(submission_datasets)):
        try:
            data_geo_cols = GeomColumns.get_geom_cols(data, True)
            geo_data = convert_to_geodata(data, data_geo_cols)
            SpatialOps.check_and_match_projection(geo_data, crs_code=projected_epsg)
            settlement_with_geom = settlement_with_geom.sjoin_nearest(
                geo_data[['geometry']],
                how='left',
                max_distance=200,
                distance_col=source_name,
                rsuffix=source_name,
            )

            settlement_with_geom.sort_values(by=f"index_{source_name}", inplace=True, ascending=False)
            settlement_with_geom.drop_duplicates(subset=unique_col, inplace=True, keep='first')
            settlement_with_geom.drop(columns=f'index_{source_name}', inplace=True)
            settlement_with_geom = set_reach(settlement_with_geom, source_name)
        except Exception as e:
            print(f'Error!: {e} encountered with {source_name}')
            continue

    settlement_list = pd.concat([settlement_with_geom, settlement_no_geom], ignore_index=True)
    settlement_list.drop_duplicates(subset=unique_col, inplace=True)
    return settlement_list
