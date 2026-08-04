import random

import numpy as np
import pandas as pd
from tqdm import tqdm
import geopandas as gpd
from scipy.spatial import KDTree
from shapely.ops import transform
from shapely.geometry import Point
from pyproj import CRS, Transformer
from shapely.affinity import translate

from toolbox.models import State
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.tools import convert_to_degrees
from toolbox.exceptions import MissingConfiguration
from toolbox.spatial_mgr import GeomColumns
from toolbox.mlos.validation.review.spatial.converters import convert_to_geodata


def shift_point(point, dx_deg, dy_deg):
    # Helper: directional shift
    return translate(point, xoff=dx_deg, yoff=dy_deg)


def is_too_close(point, others, threshold) -> bool:
    # Helper: check if too close
    return any(point.distance(other) < threshold for other in others if not point.equals(other))


def calculate_shift(distance: int, x_diff: float, y_diff: float):
    if distance == 0:
        angle = random.uniform(0, 2 * np.pi)
        dx, dy = np.cos(angle), np.sin(angle)
        dist = 1
    else:
        dx, dy = x_diff / distance, y_diff / distance
        dist = distance

    return dx, dy, dist


def create_projection(epsg: str) -> CRS:
    return CRS(f"EPSG:{epsg}")


def transform_projection(in_projection: CRS, target_projection: CRS):
    return Transformer.from_crs(in_projection, target_projection, always_xy=True).transform


def is_flagged(settlement_data: pd.DataFrame) -> bool:
    if 'proximity_issues' not in settlement_data.columns:
        return False

    if pd.isna(settlement_data['proximity_issues']).all():
        return False

    return True


def flag_settlements_within_30m(input_table: pd.DataFrame | gpd.GeoDataFrame) -> pd.DataFrame | gpd.GeoDataFrame:
    # Extract coordinates
    lat = input_table['latitude'].values
    lon = input_table['longitude'].values

    # Reproject to metric CRS for distance calculations
    wgs84: CRS = create_projection("4326")
    utm: CRS = create_projection("3857")
    project_utm = transform_projection(wgs84, utm)

    # Project coordinates
    points_proj = [transform(project_utm, Point(lon[i], lat[i])) for i in range(len(lat))]
    coords_proj = np.array([[p.x, p.y] for p in points_proj])
    #
    #check if any points are NaN or Inf
    if np.isnan(coords_proj).any():
        raise ValueError("Input data contains NaN Values")
    if np.isinf(coords_proj).any():
        raise ValueError("Input data contains Infinite  values.")
    # KDTree for fast distance search
    tree = KDTree(coords_proj)

    # Flag points that are closer than 30 m to any other point
    flags = []
    for idx, point in enumerate(coords_proj):
        neighbors = tree.query_ball_point(point, r=65)
        flags.append(len([n for n in neighbors if n != idx]) > 0)

    input_table['proximity_issues'] = flags
    flagged = input_table[input_table['proximity_issues']].copy()
    print(f"{len(flagged)} out of {len(input_table)} were within flagged points")

    return input_table


def flag_close_settlements(settlement_data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    flag_check = is_flagged(settlement_data)
    if not flag_check:
        settlement_data = flag_settlements_within_30m(settlement_data)

    return settlement_data


def enforce_min_distance(coords):
    shifter_params: dict = CONFIG.get('SHIFTER')
    tree = KDTree(coords)
    all_clear = True
    for idx, point in enumerate(coords):
        neighbors = tree.query_ball_point(point, r=shifter_params.get("MIN_DISTANCE"))
        for n in neighbors:
            if n == idx:
                continue

            all_clear = False
            dx = coords[n][0] - point[0]
            dy = coords[n][1] - point[1]
            dist = np.sqrt(dx**2 + dy**2)
            dx, dy, dist = calculate_shift(dist, dx, dy)
            shift = (shifter_params.get("TARGET_DISTANCE") - dist)
            coords[n][0] += shift * dx
            coords[n][1] += shift * dy
    return coords, all_clear


def move_points_away(flagged_data: pd.DataFrame):
    lat = flagged_data['latitude'].values
    lon = flagged_data['longitude'].values
    # flags = flagged_data['proximity_issues'].values

    # CRS projection setup
    wgs84 = create_projection("4326")
    utm = create_projection("3857")
    wgs_to_utm = transform_projection(wgs84, utm)
    utm_to_wgs = transform_projection(utm, wgs84)

    # Convert to projected coordinates
    coords_proj = np.array([list(transform(wgs_to_utm, Point(lon[i], lat[i])).coords)[0] for i in range(len(lat))])
    shifted_coords = coords_proj.copy()

    max_iterations: int = CONFIG.get("SHIFTER").get("ITERATIONS")
    for _ in range(max_iterations):
        shifted_coords, ok = enforce_min_distance(shifted_coords)
        if ok:
            break

    # Convert back to lat/lon
    shifted_points = [transform(utm_to_wgs, Point(x, y)) for x, y in shifted_coords]
    shifted_latlon = np.array([[p.y, p.x] for p in shifted_points])

    # Output
    flagged_data['Shifted_Latitude'] = shifted_latlon[:, 0]
    flagged_data['Shifted_Longitude'] = shifted_latlon[:, 1]

    return flagged_data


def clean_results(gdf: gpd.GeoDataFrame):
    cols_to_drop = CONFIG.get('DROPPING').get('SHIFTER')
    gdf['latitude'] = gdf['New_Latitude']
    gdf['longitude'] = gdf['New_Longitude']

    gdf.drop(columns=cols_to_drop, errors='ignore', inplace=True)
    return gdf


def move_points_within_boundary(settlement_df: pd.DataFrame, state_name: State):
    settlement_df.drop(columns='index_right', errors='ignore', inplace=True)
    try:

        datasets: dict = CONFIG['DATASETS']
        shifter_params: dict = CONFIG['SHIFTER']
        shift_min_dist: int| float = shifter_params['MIN_DISTANCE']
        directions: list[str] = shifter_params["DIRECTIONS"]
        shift_distance: int | float = shifter_params["SHIFT_DISTANCE"]
    except KeyError as e:
        raise MissingConfiguration('Invalid or Missing Configuration', f'{e}')

    min_distance: int | float = convert_to_degrees(shift_min_dist)
    shift_distance: int | float = convert_to_degrees(shift_distance)
    wards_gdf: gpd.GeoDataFrame = ReadDBData(datasets.get('ward_boundary'), True).read_data(
        {"statename": [state_name.value]}
    )

    extents_gdf: gpd.GeoDataFrame = ReadDBData(datasets.get('grid_3_extent'), True).read_data(
        {"statename": [state_name.value]}
    )

    geo_cols = GeomColumns.get_geom_cols(settlement_df, True)
    gdf = convert_to_geodata(settlement_df, geo_cols)
    gdf['original_geom'] = gdf.geometry

    # Track shifted points
    shifted_points = []

    # Prepare output geometries
    new_geometries = []

    for idx, row in tqdm(gdf.iterrows(), total=len(gdf), desc='moving'):
        point = row['original_geom']
        ward_poly = next((poly for poly in wards_gdf.geometry if point.within(poly)), None)
        # extent_poly = next((poly for poly in extents_gdf.geometry if point.within(poly)), None)
        # Check if the current point is too close to any previous
        if row['proximity_issues'] is False:
            new_geometries.append(point)
            continue

        if is_too_close(point, shifted_points, min_distance):
            found_new = False
            for direction in directions:
                dx = dy = 0
                if 'right' in direction:
                    dx += shift_distance
                if 'left' in direction:
                    dx -= shift_distance
                if 'up' in direction:
                    dy += shift_distance
                if 'down' in direction:
                    dy -= shift_distance

                new_point = shift_point(point, dx, dy)
                if (ward_poly and new_point.within(ward_poly)) and not is_too_close(new_point, shifted_points,
                                                                                    min_distance):
                    point = new_point
                    found_new = True
                    break

            # Move to nearest extent centroid
            if not found_new:
                extents_gdf['dist'] = extents_gdf.geometry.centroid.distance(point)
                nearest = extents_gdf.sort_values('dist').iloc[0]
                point = nearest.geometry.centroid

        shifted_points.append(point)
        new_geometries.append(point)

    # Assign new geometries
    gdf['original_geom'] = new_geometries
    gdf['New_Longitude'] = gdf['original_geom'].apply(lambda geom: geom.x)
    gdf['New_Latitude'] = gdf['original_geom'].apply(lambda geom: geom.y)

    return gdf


def auto_shift_points(data: pd.DataFrame, state: State):
    """Shift Points to locations that do not violate the proximity checks and within ward boundaries"""
    flagged_data = flag_settlements_within_30m(data)
    if flagged_data.loc[flagged_data['proximity_issues']].empty:
        return flagged_data

    dispersed_data = move_points_away(flagged_data)
    shifted_data = move_points_within_boundary(dispersed_data, state)
    final_settlement_data = clean_results(shifted_data)
    return final_settlement_data