import logging
import pandas as pd
import geopandas as gpd

from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.mlos import AdminColumns
from toolbox.spatial_mgr import SpatialOps, convert_to_geodata, GeomColumns
from toolbox.target_area import create_tesselation_polygon, extract_locations, check_admin


def fallback_voronoi(geo_data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    logging.info('Using Buffer to Create Voronoi...')

    out_voronoi: gpd.GeoDataFrame = geo_data.copy()
    out_voronoi["geometry"] = out_voronoi.geometry.buffer(CONFIG['FALLBACK_BUFFER'])
    return out_voronoi


def clip_to_boundary(raw_voronoi: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame):
    logging.info('Intersecting to Boundary and Excluding Voronoi Artefacts')
    voronoi_copy = raw_voronoi.copy()
    voronoi_copy = voronoi_copy.overlay(boundary[['geometry', 'statename', 'lganame', 'wardname']])
    location_admin = AdminColumns('state_location', 'lga_location', 'ward_location')
    boundary_admin = AdminColumns('statename', 'lganame', 'wardname')
    voronoi_copy['validation'] = voronoi_copy.apply(check_admin, args=(location_admin, boundary_admin), axis=1)
    voronoi_copy = voronoi_copy.loc[voronoi_copy['validation'].isnull()]
    return voronoi_copy


def identify_non_overlapping_extent(settlement_voronoi: gpd.GeoDataFrame, global_id: str) -> gpd.GeoDataFrame:
    logging.info('Reviewing Settlement Voronoi...')
    locations = extract_locations(settlement_voronoi, None, None)

    intersection = settlement_voronoi.sjoin(locations[['geometry']], how="left", predicate='intersects')
    intersected_voronoi = intersection.loc[intersection['index_right'].notna()]
    intersected_uuids = intersected_voronoi[global_id].tolist()
    logging.info(f'Voronoi Intersecting Settlements: {len(intersected_uuids):,}')

    pending_pts = locations[~locations[global_id].isin(intersected_uuids)]
    pending_voronoi = gpd.GeoDataFrame()
    if len(pending_pts) > 0:
        logging.info(f'Found {len(pending_pts)} pending points. Adopting Fallback Methodology')
        pending_voronoi = fallback_voronoi(pending_pts)
        pending_voronoi['type'] = 'DEFAULT'

    updated_settlement_voronoi = pd.concat([intersected_voronoi, pending_voronoi], ignore_index=True)
    logging.info(f'Total Settlements with TA: {len(updated_settlement_voronoi):,}')
    return updated_settlement_voronoi


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

    settlement_voronoi.drop(columns='index_right', inplace=True)
    settlement_voronoi = identify_non_overlapping_extent(settlement_voronoi, global_id)
    intersecting_ids = settlement_voronoi[global_id].tolist()
    non_intersecting_ids = voronoi_data.loc[~voronoi_data[global_id].isin(intersecting_ids), global_id].values.tolist()

    if not non_intersecting_ids:
        return settlement_voronoi

    pending_locations = extract_locations(voronoi_data, global_id, non_intersecting_ids)
    pending_voronoi = fallback_voronoi(pending_locations)
    pending_voronoi['type'] = 'DEFAULT'
    settlement_voronoi = pd.concat([settlement_voronoi, pending_voronoi], ignore_index=True)

    return settlement_voronoi


@timer
def build_state_voronoi(settlements: gpd.GeoDataFrame, grid3_extent: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame,
                        state_name: str, unique_column: str, required_columns: list[str]) -> gpd.GeoDataFrame:

    logging.info(f'Generating Settlement Voronoi for {state_name}...')
    SpatialOps.check_and_match_projection(boundary, settlements)
    settlements = settlements.sjoin(boundary[['geometry', 'statename', 'lganame', 'wardname']], how='left')
    settlements.rename(
        columns={col: col.replace("name", "_location") for col in ['statename', 'lganame', 'wardname']},
        inplace=True
    )

    out_voronoi = create_tesselation_polygon(settlements) if len(settlements)>=4 else fallback_voronoi(settlements)
    state_voronoi: gpd.GeoDataFrame = clip_to_boundary(out_voronoi, boundary)
    state_voronoi = state_voronoi.dissolve(by=unique_column).reset_index(drop=False, names=unique_column)

    SpatialOps.check_and_match_projection(grid3_extent, state_voronoi)
    if len(state_voronoi) < len(settlements):
        voronois = state_voronoi[unique_column].tolist()
        missing_settlements = settlements.loc[~settlements[unique_column].isin(voronois)]
        missing_voronoi = fallback_voronoi(missing_settlements)
        missing_voronoi['type'] = 'DEFAULT'
        state_voronoi = pd.concat([state_voronoi, missing_voronoi], ignore_index=True)

    settlement_voronoi = overlay_against_extent(state_voronoi, grid3_extent, unique_column)
    keep_cols = required_columns + ["geometry"]
    settlement_voronoi = settlement_voronoi[[c for c in keep_cols if c in settlement_voronoi.columns]]

    return settlement_voronoi


if __name__ == '__main__':
    from toolbox.mlos import detect_unique_admin_field, MLoSAttributes
    from toolbox.models import Policy
    from toolbox.access import ReadDBData

    state_df = pd.read_excel(r"C:\Workspace\MLoS\validation\Kebbi_Harmonised_MLoS_Manager.xlsx", sheet_name='eHA')
    state_data = convert_to_geodata(state_df, GeomColumns(latitude='latitude', longitude='longitude'))
    state_data = state_data.loc[state_data["latitude"].notnull()]
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
