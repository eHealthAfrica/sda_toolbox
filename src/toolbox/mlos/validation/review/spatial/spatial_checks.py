import concurrent.futures
import logging

import geopandas as gpd
from tqdm import tqdm
import pandas as pd

from toolbox import CPU_COUNT
from toolbox.access import ReadDBData
from toolbox.utils import timer
from toolbox.models import State
from toolbox.configs import CONFIG
from toolbox.exceptions import MissingConfiguration
from toolbox.tools import issues_counter, create_chunks
from toolbox.fixers.shifter import flag_settlements_within_30m
from toolbox.mlos.validation.review.spatial import administrative_info_checks
from toolbox.spatial_mgr import GeomColumns, SpatialOps, ProjectionType
from toolbox.mlos.validation.review.spatial.converters import convert_to_geodata, convert_str_to_float


def find_missing_coordinates(data: pd.DataFrame, geo_cols: GeomColumns) -> pd.DataFrame:
    logging.info('Checking for Settlements with No Coordinates')
    data.loc[
        (data[geo_cols.latitude].isnull()) |
        (data[geo_cols.longitude].isnull()),
        ['no_coordinates']
    ] = 'No Coordinates'

    missing_coords = data.loc[data['no_coordinates'].notnull()]
    print(f"Settlements with No Coordinates: {len(missing_coords)}")

    return data


def evaluate_proximity(data: gpd.GeoDataFrame, admin_unique_code: str, reference_data: gpd.GeoDataFrame):

    joined_data = data.sjoin_nearest(reference_data[['geometry', admin_unique_code]], how='right', max_distance=60,
                                     distance_col='distance')

    data_unique_code = f"{admin_unique_code}_left"
    reference_unique_code = f"{admin_unique_code}_right"

    matched = joined_data.loc[
        (joined_data[data_unique_code].notna()) &
        (joined_data[data_unique_code] != joined_data[reference_unique_code])
        ]

    if matched.empty:
        return data

    new_unique = data_unique_code.replace("_left", "")
    sorted_diff = (
        matched.sort_values(by='distance', ascending=False)
               .rename(columns={data_unique_code: new_unique})
               .reset_index(drop=True)
    )
    return sorted_diff.iloc[[0]]


def classify_distance(row: pd.Series) -> None | str:
    distance = row.get('distance')

    if pd.isna(distance) or distance is None:
        return None

    distance = float(distance)
    if distance <= 20:
        return "Within 10m"

    if 20 >= distance > 40:
        return "Within 20m"

    return "Within 30m"


def enforce_coordinate_field_type(data: pd.DataFrame, geo_cols: GeomColumns) -> pd.DataFrame:
    logging.info('Converting Coordinate Columns to floating data type')
    latitude_type = data[geo_cols.latitude].dtype.name
    longitude_type = data[geo_cols.longitude].dtype.name

    if any([f_type == 'float' for f_type in [latitude_type, longitude_type]]):
        return data

    data[geo_cols.latitude] = data.apply(lambda row: convert_str_to_float(row[geo_cols.latitude]), axis=1)
    data[geo_cols.longitude] = data.apply(lambda row: convert_str_to_float(row[geo_cols.longitude]), axis=1)

    return data


def proximity_analysis(dataset: gpd.GeoDataFrame, admin_column):
    try:
        logging.info('Checking for Spatial Proximity Issues')
        projection_type = SpatialOps.check_projection_type(dataset)
        if projection_type == ProjectionType.GEOGRAPHIC:
            epsg = CONFIG['PRJ_EPSG']
            dataset.to_crs(epsg=epsg, inplace=True)

        data_chunks: list[gpd.GeoDataFrame] = create_chunks(dataset, 1)

        processed: list[pd.DataFrame] = []
        with concurrent.futures.ProcessPoolExecutor(max_workers=CPU_COUNT) as executor:
            futures = [
                executor.submit(evaluate_proximity, chunk, admin_column, dataset)
                for chunk in data_chunks
            ]

            for future in tqdm(concurrent.futures.as_completed(futures), total=len(dataset), desc='Checking Distance'):
                result = future.result()
                processed.append(result)

        proximity_checked = pd.concat(processed, ignore_index=True)
        proximity_checked['proximity_issues'] = proximity_checked.apply(classify_distance, axis=1)
        proximity_checked.drop(columns=["index_left", "index_right", "unique_code_right"], inplace=True, errors="ignore")

        issues_counter(proximity_checked, 'proximity_issues')

        return gpd.GeoDataFrame(proximity_checked)

    except KeyError as e:
        raise MissingConfiguration('Config attribute missing', f'{e}')


def validate_against_grid3_extent(data: gpd.GeoDataFrame, uniquecode: str):
    extent_table = CONFIG['DATASETS']['grid_3_extent']
    states: list[str] = data['state_name'].unique().tolist()
    grid_3_extent: gpd.GeoDataFrame = ReadDBData(extent_table, True).read_data({"statename": states})
    grid_3_extent = SpatialOps.check_and_match_projection(grid_3_extent, data)
    intersected: gpd.GeoDataFrame = data.sjoin(grid_3_extent[['geometry']], how='inner', predicate='intersects')
    if intersected.empty:
        data['intersects_with_grid3'] = 'Not Intersect with GRID3'
    else:
        intersected_uniques = intersected[uniquecode].unique().tolist()
        data.loc[~data[uniquecode].isin(intersected_uniques), ['intersects_with_grid3']] = 'Not Intersect with GRID3'

    issues_counter(data, 'intersects_with_grid3')
    return data


@timer
def run_spatial_checks(data: pd.DataFrame, geo_columns: GeomColumns, unique_column: str):
    """
    Runs a Series of Spatial validation Checks. This Includes:
        - Missing Coordinates
        - Administrative Boundary Checks
        - Intersection against GRID3 Settlement Extent
        - Spatial Proximity Checks

    Parameters
    ----------
    data: pd.DataFrame
        MLoS Dataset
    geo_columns: GeomColumns
        Object containing Latitude and Longitude Columns
    unique_column: str
        unique settlement name column

    Returns
    -------
        gpd.GeoDataFrame
    """

    enforced_data: pd.DataFrame = enforce_coordinate_field_type(data, geo_columns)
    missing_geo_checked: pd.DataFrame = find_missing_coordinates(enforced_data, geo_columns)
    data_gdf: gpd.GeoDataFrame = convert_to_geodata(missing_geo_checked, geo_columns)
    admin_checked: gpd.GeoDataFrame = administrative_info_checks(data_gdf)
    grid_3_checked = validate_against_grid3_extent(admin_checked, unique_column)
    data_with_coords = grid_3_checked[grid_3_checked['no_coordinates'].isna()]
    proximity_checked: gpd.GeoDataFrame = flag_settlements_within_30m(data_with_coords)
    flagged: gpd.GeoDataFrame = proximity_checked.loc[proximity_checked['proximity_issues']]
    if flagged.empty:
        return grid_3_checked

    unique_flagged = flagged[unique_column].tolist()
    proximity_distance_checked = proximity_analysis(flagged, unique_column)
    proximity_distance_checked.to_crs(epsg=4326, inplace=True)
    unflagged_df = grid_3_checked.loc[~grid_3_checked[unique_column].isin(unique_flagged)]
    spatially_checked = pd.concat(
        [unflagged_df, proximity_distance_checked], ignore_index=True).sort_values(by=unique_column)

    return spatially_checked
