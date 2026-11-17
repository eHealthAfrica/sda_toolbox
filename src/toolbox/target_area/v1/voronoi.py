import logging
import pandas as pd
import geopandas as gpd

from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.mlos import AdminColumns
from toolbox.spatial_mgr import SpatialOps, convert_to_geodata, GeomColumns
from toolbox.target_area import create_tesselation_polygon, check_admin, fallback_voronoi


def clip_to_boundary(raw_voronoi: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame):
    logging.info('Intersecting to Boundary and Excluding Voronoi Artefacts')
    voronoi_copy = raw_voronoi.copy()
    voronoi_copy = voronoi_copy.overlay(boundary[['geometry', 'statename', 'lganame', 'wardname']])
    location_admin = AdminColumns('state_location', 'lga_location', 'ward_location')
    boundary_admin = AdminColumns('statename', 'lganame', 'wardname')
    voronoi_copy['validation'] = voronoi_copy.apply(check_admin, args=(location_admin, boundary_admin), axis=1)
    voronoi_copy = voronoi_copy.loc[voronoi_copy['validation'].isnull()]
    return voronoi_copy


def own_points(pieces: gpd.GeoDataFrame) -> gpd.GeoSeries:
    """Each row's own settlement point, rebuilt from latitude/longitude and aligned to the row index."""
    pts = gpd.points_from_xy(pieces.centroid.x, pieces.centroid.y, crs=f"EPSG:{CONFIG['SOURCE_EPSG']}")
    return gpd.GeoSeries(pts, index=pieces.index).to_crs(pieces.crs)


def identify_non_overlapping_extent(settlement_voronoi: gpd.GeoDataFrame, global_id: str) -> gpd.GeoDataFrame:
    extent_snap_distance = CONFIG['FALLBACK_BUFFER']
    logging.info('Reviewing Settlement Voronoi...')
    pieces = settlement_voronoi.assign(
        _gap=settlement_voronoi.geometry.distance(own_points(settlement_voronoi)),
        _area=settlement_voronoi.geometry.area,
    )
    near = pieces.loc[pieces['_gap'] <= extent_snap_distance]
    kept = (near.sort_values(['_gap', '_area'], ascending=[True, False])
                .drop_duplicates(subset=global_id, keep='first'))

    logging.info(
        f"Settlements with an extent piece: {len(kept):,} "
        f"(point inside: {(kept['_gap'] == 0).sum():,}, within {extent_snap_distance} m: {(kept['_gap'] > 0).sum():,}); "
        f"pieces too far from their own point: {len(pieces) - len(near):,}")

    return kept.drop(columns=['_gap', '_area'])


def overlay_against_extent(voronoi_data: gpd.GeoDataFrame, extent_data: gpd.GeoDataFrame, global_id: str) -> gpd.GeoDataFrame:

    logging.info("Overlaying Voronoi against GRID3 Extent...")

    settlement_voronoi = gpd.overlay(
        voronoi_data,
        extent_data[["type", "geometry"]],
        how="intersection"
    )

    settlement_voronoi = settlement_voronoi.loc[:, ~settlement_voronoi.columns.duplicated()]
    settlement_voronoi = settlement_voronoi[~settlement_voronoi.geometry.is_empty].reset_index(drop=True)
    logging.info(f"Voronoi cells after clipping to extent: {len(settlement_voronoi):,}")

    settlement_voronoi.drop(columns='index_right', inplace=True, errors='ignore')
    settlement_voronoi = identify_non_overlapping_extent(settlement_voronoi, global_id)

    return settlement_voronoi


@timer
def build_state_voronoi(settlements: gpd.GeoDataFrame, grid3_extent: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame,
                        unique_column: str, state_name: str, required_columns: list[str]) -> gpd.GeoDataFrame:

    logging.info(f'Generating Settlement Voronoi for {state_name}...')
    SpatialOps.check_and_match_projection(boundary, settlements)
    settlements = settlements.sjoin(boundary[['geometry', 'statename', 'lganame', 'wardname']], how='left')
    settlements.rename(
        columns={col: col.replace("name", "_location") for col in ['statename', 'lganame', 'wardname']},
        inplace=True
    )
    settlements.drop_duplicates(subset=unique_column, inplace=True, keep='first')

    out_voronoi = create_tesselation_polygon(settlements) if len(settlements)>=4 else fallback_voronoi(settlements)
    state_voronoi: gpd.GeoDataFrame = clip_to_boundary(out_voronoi, boundary)
    state_voronoi = state_voronoi.dissolve(by=unique_column).reset_index(drop=False, names=unique_column)
    SpatialOps.check_and_match_projection(grid3_extent, state_voronoi)
    settlement_voronoi = overlay_against_extent(state_voronoi, grid3_extent, unique_column)

    if settlement_voronoi[unique_column].nunique() < len(settlements):
        voronoi_ids = settlement_voronoi[unique_column].tolist()
        missing_settlements = settlements.loc[~settlements[unique_column].isin(voronoi_ids)]
        missing_voronoi = fallback_voronoi(missing_settlements)
        own_cells = state_voronoi[[unique_column, 'geometry']].rename(columns={unique_column: '_cell_id'})
        own_pieces = gpd.overlay(missing_voronoi, own_cells, how='intersection')
        own_pieces = own_pieces.loc[own_pieces[unique_column] == own_pieces['_cell_id']].drop(columns='_cell_id')
        plain = missing_voronoi.loc[~missing_voronoi[unique_column].isin(own_pieces[unique_column])]
        missing_voronoi = pd.concat([own_pieces, plain], ignore_index=True)
        missing_voronoi['type'] = 'DEFAULT'
        settlement_voronoi = pd.concat([settlement_voronoi, missing_voronoi], ignore_index=True)

    settlement_voronoi.drop_duplicates(subset=unique_column, keep='first', inplace=True)
    keep_cols = required_columns + ["geometry"]
    settlement_voronoi = settlement_voronoi[[c for c in keep_cols if c in settlement_voronoi.columns]]

    return settlement_voronoi


if __name__ == '__main__':
    from toolbox.mlos import detect_unique_admin_field, MLoSAttributes
    from toolbox.models import Policy
    from toolbox.access import ReadDBData

    state_df = pd.read_excel(r"C:\Workspace\MLoS\validation\Kebbi_Harmonised_MLoS_Manager.xlsx", sheet_name='eHA')
    state_data = convert_to_geodata(state_df, GeomColumns(latitude='latitude', longitude='longitude'))
    state_data = state_data.loc[state_data['latitude'].notna()]
    attributes = MLoSAttributes()(state_data, CONFIG['ATTRIBUTE_COLUMNS'], Policy.MLOS)
    admin = AdminColumns.create_by_search(state_data)
    unique_code = detect_unique_admin_field(state_data)
    state_data.to_crs(CONFIG['PRJ_EPSG'], inplace=True)

    state_table = CONFIG['DATASETS']['ward_boundary']
    state_boundary: gpd.GeoDataFrame = ReadDBData(state_table, is_spatial=True).read_data({'statename': ['Kebbi']})

    extent_table = CONFIG['DATASETS']['grid_3_extent']
    extent: gpd.GeoDataFrame = ReadDBData(extent_table, is_spatial=True).read_data({'statename': ["Kebbi"]})
    attribute_columns = [
        unique_code, attributes.global_id, admin.state, admin.lga, admin.ward, admin.settlement, 'latitude', 'longitude',
        attributes.preset_attributes.accessibility_status, attributes.preset_attributes.habitational_status,
        attributes.numeric_attributes.set_target, attributes.numeric_attributes.number_of_household
    ]

    set_voronoi = build_state_voronoi(state_data, extent, state_boundary, "Kebbi", unique_code,  attribute_columns)
    set_voronoi.to_file(r"C:\Workspace\DEV\Toolbox\src\dev\tester.gpkg", driver="GPKG", layer='settlement_voronoi')
    state_data.to_file(r'C:\Workspace\DEV\Toolbox\src\dev\kebbi_settlements.gpkg', driver='GPKG')
