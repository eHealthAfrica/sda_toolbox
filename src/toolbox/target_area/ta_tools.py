import logging
from typing import Any
from collections import defaultdict

import numpy as np
import pandas as pd
from pyproj import CRS
import geopandas as gpd
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, box

from toolbox.tools import is_empty
from toolbox.mlos import AdminColumns
from toolbox.exceptions import DataError
from toolbox.spatial_mgr import GeomColumns, convert_to_geodata


def generate_grid(target_area: gpd.GeoDataFrame, cell_size: float) -> gpd.GeoDataFrame:
    """
    Generate square-based Grids from a reference layer (target_area)

    Parameters
    ----------
    target_area: (gpd.GeoDataFrame)
        Reference layer whose extent will be used to generate the grid
    cell_size: (float)
        Dimension of the length and width of the grid

    Returns
    -------
        gpd.GeoDataFrame gridded GeoDataFrame
    """

    logging.info(f"Generating {cell_size} by {cell_size} grids using standard Operations...")

    x_min,y_min,x_max,y_max = target_area.total_bounds
    x, y = (x_min, y_min)
    geom_array = []

    while y <= y_max:
        while x <= x_max:
            geom = Polygon([(x,y), (x+cell_size, y), (x+cell_size, y+cell_size), (x, y+cell_size)])
            geom_array.append(geom)
            x += cell_size
        x = x_min
        y += cell_size

    grid = gpd.GeoDataFrame({'geometry':geom_array}, crs=target_area.crs)
    return grid


def generate_grid_chunked(target_area: gpd.GeoDataFrame, cell_size: float, chunk_size: int, sub_chunk_size: int) -> gpd.GeoDataFrame:
    """
    Generator-based approach that yields chunks and assembles at the end
    """
    logging.info(f"Generating {cell_size} by {cell_size} grids using List comprehension...")

    x_min, y_min, x_max, y_max = target_area.total_bounds

    num_x = int(np.ceil((x_max - x_min) / cell_size))
    num_y = int(np.ceil((y_max - y_min) / cell_size))

    all_polygons = []

    # Process y-direction in larger chunks
    for y_chunk_start in range(0, num_y, chunk_size):
        y_chunk_end = min(y_chunk_start + chunk_size, num_y)
        y_coords_chunk = y_min + np.arange(y_chunk_start, y_chunk_end) * cell_size

        # Process x-direction in smaller sub-chunks within each y-chunk
        for x_chunk_start in range(0, num_x, sub_chunk_size):
            x_chunk_end = min(x_chunk_start + sub_chunk_size, num_x)
            x_coords_subchunk = x_min + np.arange(x_chunk_start, x_chunk_end) * cell_size

            # Create polygons for this sub-chunk
            subchunk_polygons = [
                Polygon([
                    (x, y),
                    (x + cell_size, y),
                    (x + cell_size, y + cell_size),
                    (x, y + cell_size)
                ])
                for y in y_coords_chunk
                for x in x_coords_subchunk
            ]

            all_polygons.extend(subchunk_polygons)

    return gpd.GeoDataFrame({'geometry': all_polygons}, crs=target_area.crs)


def generate_grid_ii(target_area: gpd.GeoDataFrame, cell_size: float) -> gpd.GeoDataFrame:
    """
    Generate square-based Grids from a reference layer (target_area)

    Parameters
    ----------
    target_area: (gpd.GeoDataFrame)
        Reference layer whose extent will be used to generate the grid
    cell_size: (float)
        Dimension of the length and width of the grid

    Returns
    -------
        gpd.GeoDataFrame gridded GeoDataFrame
    """
    logging.info(f"Generating {cell_size} by {cell_size} grids using Vectorized Operations...")
    x_min, y_min, x_max, y_max = target_area.total_bounds

    # Calculate number of cells in x and y directions
    num_x = int(np.ceil((x_max - x_min) / cell_size))
    num_y = int(np.ceil((y_max - y_min) / cell_size))

    # Generate all x and y coordinates at once using vectorized operations
    x_coords = x_min + np.arange(num_x + 1) * cell_size
    y_coords = y_min + np.arange(num_y + 1) * cell_size

    # Create meshgrid for all cell corners
    xx, yy = np.meshgrid(x_coords[:-1], y_coords[:-1])

    # Vectorized creation of polygons
    polygons = []
    for i in range(num_y):
        for j in range(num_x):
            polygon = Polygon([
                (xx[i, j], yy[i, j]),
                (xx[i, j] + cell_size, yy[i, j]),
                (xx[i, j] + cell_size, yy[i, j] + cell_size),
                (xx[i, j], yy[i, j] + cell_size)
            ])
            polygons.append(polygon)

    return gpd.GeoDataFrame({'geometry': polygons}, crs=target_area.crs)


def standardize_settlements(settlements: gpd.GeoDataFrame, state_col: str, subset: gpd.GeoDataFrame, admin_col: str) -> None:

    validate_state_membership(subset, settlements, state_col)
    validate_settlement_membership(settlements, subset, admin_col)

    return None


def validate_settlement_membership(complete_list: pd.DataFrame, subset: gpd.GeoDataFrame, admin_col: str):
    complete_settlements = complete_list[admin_col].unique().tolist()
    subset_settlements = subset[admin_col].unique().tolist()

    missing_settlements = [settlement for settlement in subset_settlements if settlement not in complete_settlements]
    if missing_settlements:
        raise DataError(
            "Missing Settlements", f'{len(missing_settlements)} Settlements in the subset are not in the complete settlement list')


def validate_state_membership(settlement_subset: gpd.GeoDataFrame, settlements: gpd.GeoDataFrame, state_col: str) -> None:
    complete_state_list = settlements[state_col].str.title().unique().tolist()
    subset_state_list = settlement_subset[state_col].str.title().unique().tolist()

    if any(state_name for state_name in complete_state_list if state_name not in subset_state_list):
        raise DataError("Missing States", 'Some States are missing')

    if any(state_name for state_name in subset_state_list if state_name not in complete_state_list):
        raise DataError("Missing States", 'Some States are missing')

    return None



def grid_reviewer(row: pd.Series, building_limit: int) -> str | None:
    buildings: int = row.get('building_count')

    if is_empty(buildings):
        return "drop"

    if buildings<= building_limit:
        return "drop"

    return None


def create_grid_cells(bounds: tuple[int, int, ..., ...], size: int, crs: CRS):
    """Return a list of box geometries tiling the given bounds at 'size' metres."""
    xmin, ymin, xmax, ymax = bounds
    xs = np.arange(xmin, xmax, size)
    ys = np.arange(ymin, ymax, size)
    boxes =  [box(x, y, x + size, y + size) for x in xs for y in ys]

    return gpd.GeoDataFrame({'geometry': boxes}, crs=crs).set_geometry('geometry')


def create_voronoi(geo_data: gpd.GeoDataFrame) -> tuple[Voronoi, Polygon] | None:
    buffer_pct = 0.10
    coords = np.array([(geom.x, geom.y) for geom in geo_data.geometry])

    if len(coords) < 4:
        return None

    xmin, ymin = coords.min(axis=0)
    xmax, ymax = coords.max(axis=0)
    dx = (xmax - xmin) * buffer_pct or 1000.0
    dy = (ymax - ymin) * buffer_pct or 1000.0
    envelope = box(xmin - dx, ymin - dy, xmax + dx, ymax + dy)

    vor = Voronoi(coords, qhull_options="Qbb Qc Qx")
    return vor, envelope


def map_vertices(vor: Voronoi) -> defaultdict[Any, set]:

    point_to_vertices = defaultdict(set)
    for (p1, p2), (v1, v2) in zip(vor.ridge_points, vor.ridge_vertices):
        if v1 >= 0:
            point_to_vertices[p1].add(v1)
            point_to_vertices[p2].add(v1)
        if v2 >= 0:
            point_to_vertices[p1].add(v2)
            point_to_vertices[p2].add(v2)

    return point_to_vertices


def generate_vertexes(geo_data: gpd.GeoDataFrame, point_to_vertices: defaultdict, vor: Voronoi, envelope: Polygon):
    polygons, keep_idx = [], []

    for idx in range(len(geo_data)):
        vertex = point_to_vertices.get(idx)
        if not vertex or len(vertex) < 3:
            continue

        vertex_pts = [vor.vertices[v] for v in vertex]
        poly = Polygon(vertex_pts).convex_hull
        poly = poly.intersection(envelope)
        if poly.is_empty or poly.area <= 0:
            continue

        polygons.append(poly)
        keep_idx.append(idx)

    if not polygons:
        return None

    return polygons, keep_idx


def convert_vertices_to_polygon(geo_data: gpd.GeoDataFrame, polygons: list[Polygon], indexes: list[int]) -> gpd.GeoDataFrame:
    out_data = geo_data.iloc[indexes].copy().reset_index(drop=True)
    out_data["geometry"] = polygons # noqa
    out_voronoi: gpd.GeoDataFrame = gpd.GeoDataFrame(out_data, geometry="geometry", crs=geo_data.crs)
    return out_voronoi


def create_tesselation_polygon(points: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    voronoi, envelope = create_voronoi(points)
    point_to_vertices = map_vertices(voronoi)
    polygons, keep_idx = generate_vertexes(points, point_to_vertices, voronoi, envelope)
    polygon: gpd.GeoDataFrame = convert_vertices_to_polygon(points, polygons, keep_idx)

    return polygon


def extract_locations(dataset: gpd.GeoDataFrame, subset_col: str = None, subset_names: list[str]=None) -> gpd.GeoDataFrame:
    dataset_copy = dataset.copy()
    locations = convert_to_geodata(
        dataset_copy, GeomColumns(latitude='latitude', longitude='longitude')).to_crs(dataset.crs)
    locations.drop_duplicates(subset='geometry', inplace=True)
    if not subset_col:
        return locations

    return locations.loc[locations[subset_col].isin(subset_names)]


def check_admin(row: pd.Series, data_admin: AdminColumns, boundary_admin: AdminColumns):
    state_value: str = row[data_admin.state]
    boundary_state_value: str = row[boundary_admin.state]
    if pd.isna(boundary_state_value) and pd.isna([row['latitude'], row['longitude']]).any():
        return None

    if pd.isna(state_value):
        return None

    if pd.isna(boundary_state_value):
        return "Outside State"

    if state_value.lower() != boundary_state_value.lower():
        return "Outside State"

    lga_value: str = row[data_admin.lga]
    boundary_lga_value: str = row[boundary_admin.lga]
    if pd.isna(lga_value):
        return None

    if pd.isna(boundary_lga_value):
        return "Outside LGA"

    if lga_value.lower() != boundary_lga_value.lower():
        return "Outside LGA"

    ward_value: str = row[data_admin.ward]
    boundary_ward_value: str = row[boundary_admin.ward]
    if pd.isna(ward_value):
        return None

    if pd.isna(boundary_ward_value):
        return "Outside Ward"

    if ward_value.lower() != boundary_ward_value.lower():
        return "Outside Ward"

    return None
