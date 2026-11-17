import logging
from typing import Any
from dataclasses import dataclass
from collections import defaultdict
from collections.abc import Iterable, Sized

import numpy as np
import pandas as pd
from pyproj import CRS
import geopandas as gpd
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, box
from shapely.geometry.point import Point

from toolbox.configs import CONFIG
from toolbox.tools import is_empty
from toolbox.mlos import AdminColumns
from toolbox.exceptions import DataError, InvalidInputError
from toolbox.spatial_mgr import GeomColumns, convert_to_geodata


@dataclass
class GeneratorDatasets:
    unique_column: str
    settlement_data: gpd.GeoDataFrame
    boundary_data: gpd.GeoDataFrame
    voronoi_data: gpd.GeoDataFrame
    grids_data: gpd.GeoDataFrame
    buildings_data: gpd.GeoDataFrame


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
    buildings: int = row.get('building_count', 0)

    if is_empty(buildings):
        return "drop"

    if buildings<= building_limit:
        return "drop"

    return None


def create_grid_cells(bounds: tuple, size: int, crs: CRS):
    """Return a list of box geometries tiling the given bounds at 'size' metres."""
    x_min, y_min, x_max, y_max = bounds
    xs = np.arange(x_min, x_max, size)
    ys = np.arange(y_min, y_max, size)
    boxes =  [box(x, y, x + size, y + size) for x in xs for y in ys]

    return gpd.GeoDataFrame({'geometry': boxes}, crs=crs).set_geometry('geometry')


def create_voronoi(geo_data: gpd.GeoDataFrame, min_margin=0.0) -> tuple[Voronoi, Polygon] | None:
    buffer_pct = 0.10
    coords = np.array([(geom.x, geom.y) for geom in geo_data.geometry])

    if len(coords) < 2:
        return None

    xmin, ymin = coords.min(axis=0)
    xmax, ymax = coords.max(axis=0)
    dx = max((xmax - xmin) * buffer_pct, min_margin)or 1000.0
    dy = max((ymax - ymin) * buffer_pct, min_margin) or 1000.0
    envelope = box(xmin - dx, ymin - dy, xmax + dx, ymax + dy)

    # Four anchor points well outside the data close every real cell. They are appended after the real
    # points, so real point i is still index i and generate_vertexes (which loops over the real rows only)
    # is unchanged. Their own cells are never used.
    span = max(xmax - xmin, ymax - ymin, 1000.0)
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    reach = span * 4
    anchors = np.array([(cx - reach, cy - reach), (cx + reach, cy - reach),
                        (cx + reach, cy + reach), (cx - reach, cy + reach)])

    vor = Voronoi(np.vstack([coords, anchors]), qhull_options="Qbb Qc Qx")
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
        vertex: Iterable = point_to_vertices.get(idx)
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
    logging.info('Creating Voronoi Polygons')
    voronoi, envelope = create_voronoi(points)
    point_to_vertices = map_vertices(voronoi)
    polygons, keep_idx = generate_vertexes(points, point_to_vertices, voronoi, envelope)
    polygon: gpd.GeoDataFrame = convert_vertices_to_polygon(points, polygons, keep_idx)

    return polygon


def extract_locations(dataset: pd.DataFrame, subset_col: str | None, subset_names: list[str] | None) -> gpd.GeoDataFrame:
    dataset_copy: pd.DataFrame = dataset.copy()
    locations: gpd.GeoDataFrame = convert_to_geodata(
        dataset_copy, GeomColumns(latitude='latitude', longitude='longitude')).to_crs(dataset_copy.crs)

    locations.drop_duplicates(subset='geometry', inplace=True)

    if not subset_col:
        return locations

    if not subset_names:
        raise InvalidInputError("Missing Parameter", "Provide Names to Subset")

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


def find_overlapping_geometries(voronoi: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Joins the dataset to itself and removes location where both indexes are the same as well where index numbers
    are revered indexes eg: 1 - 2 and 2 -1. leaving only unique intersections as the overlapping geometries"""
    if not has_overlapping_geometries(voronoi):
        return gpd.GeoDataFrame()

    overlaps = gpd.sjoin(voronoi, voronoi, how="inner", predicate="intersects")
    overlaps = overlaps[overlaps.index != overlaps["index_right"]]
    index_pairs = np.sort(overlaps[[overlaps.index.name or 'index', 'index_right']].values, axis=1)
    overlaps = overlaps.iloc[~gpd.pd.DataFrame(index_pairs).duplicated().values]

    return overlaps[[overlaps.index.name or 'index', 'index_right']]


def has_overlapping_geometries(voronoi: gpd.GeoDataFrame) -> bool:
    has_overlaps = voronoi.union_all().area < voronoi.area.sum()
    return has_overlaps


def fallback_voronoi(geo_data: gpd.GeoDataFrame, distance: int = None) -> gpd.GeoDataFrame:
    logging.info('Using Buffer to Create Voronoi...')

    out_voronoi: gpd.GeoDataFrame = geo_data.copy()
    buffer_distance = distance if distance else CONFIG['FALLBACK_BUFFER']
    circles = out_voronoi.geometry.buffer(buffer_distance)

    tessellation = create_voronoi(out_voronoi, min_margin=buffer_distance * 2)
    if tessellation is not None:
        vor, envelope = tessellation
        generated = generate_vertexes(out_voronoi, map_vertices(vor), vor, envelope)
        if generated:
            polygons, keep_idx = generated
            cell_list = [None] * len(out_voronoi)
            for position, polygon in zip(keep_idx, polygons):
                cell_list[position] = polygon
            cells = gpd.GeoSeries(cell_list, index=out_voronoi.index, crs=out_voronoi.crs)
            trimmed = circles.intersection(cells)
            circles = trimmed.where(~(cells.isna() | trimmed.is_empty), circles)

    out_voronoi['geometry'] = circles

    return out_voronoi


def fallback_grids(pending_voronoi: gpd.GeoDataFrame, start_id=1):
    logging.info(f'Adopting Fallback Grids for {len(pending_voronoi)} Pending Settlements...')
    grid_parts: list[gpd.GeoDataFrame] = []
    voronoi_cols = [col for col in pending_voronoi.columns]
    for _, row in pending_voronoi.iterrows():
        size = 75
        _cells = create_grid_cells(row.geometry.bounds, size, pending_voronoi.crs)
        if _cells.empty:
            continue

        values = {col: [row[col]] for col in voronoi_cols}
        tmp_overlaps = gpd.overlay(
            _cells,
            gpd.GeoDataFrame(geometry=[row.geometry]),
            how="intersection"
        )

        if len(tmp_overlaps) == 0:
            continue

        tmp_overlaps['extent_type'] = row['type']
        grid_parts.append(tmp_overlaps)

    default_grids = gpd.GeoDataFrame(pd.concat(grid_parts, ignore_index=True)) if grid_parts else gpd.GeoDataFrame()
    overlapping_grids = default_grids.overlay(pending_voronoi, how='intersection')
    overlapping_grids['area_sqm'] = overlapping_grids.area
    overlapping_grids = overlapping_grids.loc[overlapping_grids['area_sqm'] > int(CONFIG['AREA_LIMIT'])]
    grids_count = len(overlapping_grids)
    row_ids = range(start_id, grids_count + start_id, 1)
    overlapping_grids['rowid'] = row_ids
    logging.info(f"Total Overlapping Fallback Grid Cells: {grids_count:,}")
    return overlapping_grids


def assess_grids(row: pd.Series):
    grid_building_count = row["building_count"]
    if is_empty(grid_building_count):
        return 'Drop'

    residential_bds_count = row['Residential']
    residential_bds_count = residential_bds_count if pd.notna(residential_bds_count) else 0
    non_residential_bds_count = row['Non-Residential']
    non_residential_bds_count = non_residential_bds_count if pd.notna(non_residential_bds_count) else 0
    if non_residential_bds_count == 0:
        return "Keep"

    if residential_bds_count/grid_building_count >= 0.6:
        return "Keep"

    return "Drop"


def review_grids_by_building_class(settlement_grids: pd.DataFrame) -> pd.DataFrame:
    grids = settlement_grids.copy()
    grids['status'] = grids.apply(assess_grids, axis=1)
    droppable_grids: pd.DataFrame = grids.loc[grids["status"]=='Drop']

    if len(droppable_grids) == len(grids):
        # Adopts all grids for settlements extents that do not intersect any buildings
        non_residential_grids = grids.loc[grids['Non-Residential'].notna()]
        approved_grids = non_residential_grids if not non_residential_grids.empty else grids
        return approved_grids

    else:
        droppable_indexes = droppable_grids.index.tolist()
        passed_grid_group = grids.loc[~grids.index.isin(droppable_indexes)]
        return passed_grid_group


def cleanup_grids(grids_data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    def harmonize_type(*types):
        type1, type2, type3 = types
        if pd.notna(type1):
            return type1

        elif pd.notna(type2):
            return type2

        return type3

    grids_data['type'] = grids_data.apply(
        lambda row: harmonize_type(row['type'], row['type_1'], row['extent_type']), axis=1)

    (
        grids_data.drop(columns=['type_1', 'extent_type', 'Non-Residential', 'building_count'])
                   .rename(columns={'Residential': 'building_count'}, inplace=True)
        )

    cols_order = [
        'rowid', 'eha_guid', 'unique_code', 'state_name', 'lga_name', 'ward_name', 'settlement_name',
        'latitude', 'longitude', 'set_target', 'number_of_household', 'accessibility_status', 'building_count',
        'weight', 'type', 'area_sqm', 'geometry'
    ]

    cols = [col for col in cols_order if col in grids_data.columns]
    return grids_data[cols]


def preview_settlements(settlements: gpd.GeoDataFrame, guid_col: str, admin_code_col: str):
    settlement_view = settlements.copy()
    settlement_view = settlement_view.loc[
        (settlement_view.geometry.x!=0) & (settlement_view.geometry.y!=0)
    ]

    # A missing id is not a duplicate of another missing id, so only filled values are compared.
    duplicate_masks = {
        'a location shared with another settlement': settlement_view.duplicated(subset='geometry', keep=False),
        'a duplicated unique code': settlement_view.duplicated(subset=admin_code_col, keep=False) & settlement_view[admin_code_col].notna(),
        'a duplicated GUID': settlement_view.duplicated(subset=guid_col, keep=False) & settlement_view[guid_col].notna(),
        'missing GUID': settlement_view[guid_col].isna()
    }

    errors = []
    for problem, mask in duplicate_masks.items():
        count = int(mask.sum())
        if count < 1:
            continue
        examples = ', '.join(str(code) for code in settlement_view.loc[mask, admin_code_col].head(3))
        errors.append(f"{count:,} settlements have {problem} (e.g. {examples})")

    if errors:
        raise DataError('Duplicates Found', "; ".join(errors))

    return settlement_view
