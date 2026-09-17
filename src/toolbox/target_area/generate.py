import logging
from enum import StrEnum
from typing import Optional
from dataclasses import dataclass

import pandas as pd
from tqdm import tqdm
import geopandas as gpd

from toolbox.exceptions import DataError
from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.models import State, Policy
from toolbox.spatial_mgr import GeomColumns
from toolbox.target_area.voronoi import build_state_voronoi
from toolbox.target_area.gridded import build_settlement_grids
from toolbox.mlos import MLoSAttributes, AdminColumns, detect_unique_admin_field, construct_new_unique


@dataclass
class TADatasets:
    voronoi: gpd.GeoDataFrame
    gridded_ta: gpd.GeoDataFrame
    voronoi_subset: Optional[gpd.GeoDataFrame] = None
    gridded_ta_subset: Optional[gpd.GeoDataFrame] = None



class Identifier(StrEnum):
    concat = 'concat'
    uuid = 'uuid'


@timer
def generate_ta_datasets(
        state_data: gpd.GeoDataFrame, state_boundary: gpd.GeoDataFrame, extent: gpd.GeoDataFrame,
        building_footprint: gpd.GeoDataFrame, columns: list[str], state: str, admin_code: str) -> TADatasets:
    """Generates that Voronoi and Gridded TA Datasets"""
    logging.info(f"Generating Voronoi for {state}")
    state_settlement_voronoi = build_state_voronoi(
        state_data,
        extent,
        state_boundary,
        state,
        admin_code,
        columns
    )

    logging.info(f"Generating Gridded TA Datasets for {state}")
    state_gridded_ta = build_settlement_grids(
        state_settlement_voronoi,
        building_footprint,
        admin_code
    )

    logging.info(f'Completed Target Area Operations for {state}')
    return TADatasets(voronoi=state_settlement_voronoi, gridded_ta=state_gridded_ta)


def compile_datasets(ta_datasets: list[TADatasets], unique_col: str, subset: gpd.GeoDataFrame=None) -> TADatasets:
    """Compile the list of datasets subset against planned settlements and reproject to WGS 84 Geographic Projection"""
    logging.info("Compiling Voronoi and Gridded Datasets into Single Dataset and Reprojecting to WGS 84")
    all_voronoi = [ds.voronoi for ds in ta_datasets]
    all_gridded_ta = [ds.gridded_ta for ds in ta_datasets]

    if pd.isna(all_voronoi).all():
        raise DataError("No Data", "No Target Area Data were generated")

    compiled_voronoi = pd.concat(all_voronoi, ignore_index=True).to_crs(4326)
    compiled_gridded_ta = pd.concat(all_gridded_ta, ignore_index=True).to_crs(4326)

    ta_dataset = TADatasets(
        compiled_voronoi,
        compiled_gridded_ta
    )

    if subset is None:
        return ta_dataset

    logging.info('Subsetting Target Area Datasets For Planned Settlement List')
    subset_settlements: list = subset.loc[~subset.geometry.is_empty, unique_col].values.unique().tolist()
    logging.info(f"Planned Settlements with coordinates: {len(subset_settlements):,}")
    subset_voronoi = compiled_voronoi.loc[compiled_voronoi[unique_col].isin(subset_settlements)]
    subset_gridded_ta = compiled_gridded_ta.loc[compiled_gridded_ta[unique_col].isin(subset_settlements)]
    logging.info(f"Found Voronoi Subset Settlements: {len(subset_voronoi):,}")

    ta_dataset.voronoi_subset = subset_voronoi
    ta_dataset.gridded_ta_subset = subset_gridded_ta

    return ta_dataset


@timer(display=True)
def generate_settlement_target_area(settlements: gpd.GeoDataFrame, planned_list: gpd.GeoDataFrame, unique_column: Identifier) -> TADatasets:
    """
    Primary Function that generates the Voronoi and Gridded TA of a Settlement List

    Parameters
    ----------
    settlements: gpd.GeoDataFrame
        The Complete State(s) MLoS

    planned_list: gpd.GeoDataFrame
        A Planned Subset of Settlements for different states

    Returns
    -------
        TADatasets: Target Area Datasets
    """
    geom: GeomColumns = GeomColumns.get_geom_cols(settlements, True)
    mlos = MLoSAttributes()(settlements, CONFIG['ATTRIBUTE_COLUMNS'], Policy.MLOS)
    admin = AdminColumns.create_by_search(settlements)
    unique_code: str = detect_unique_admin_field(settlements)

    settlements: gpd.GeoDataFrame = settlements.loc[
        (settlements[geom.latitude].notna())
        & (settlements[geom.longitude].notna())
    ]

    settlements.to_crs(CONFIG['PRJ_EPSG'], inplace=True)

    if not unique_code:
        unique_code = 'unique_code'
        settlements = construct_new_unique(settlements, unique_code)

    unique_col: str = mlos.global_id if unique_column==Identifier.uuid else unique_code
    logging.info(f"Using {unique_col} for Operations")

    attribute_columns = [
        unique_code, mlos.global_id, admin.state, admin.lga, admin.ward, admin.settlement,
        geom.latitude, geom.longitude, 'type', mlos.numeric_attributes.set_target,
        mlos.numeric_attributes.number_of_household, mlos.preset_attributes.accessibility_status
    ]

    table_ds: dict[str, str] = CONFIG['DATASETS']
    states: list[str] = settlements[admin.state].str.title().unique().tolist()
    state_info: dict[str, str] = {state: State[state].state_code for state in states}

    print(f"Fetching Database Layers for {len(states)} States: {', '.join(state_info.keys())} State(s)....")
    logging.info(f"Fetching Database Layers for {', '.join(state_info.keys())} State(s)....")
    state_boundaries: gpd.GeoDataFrame = ReadDBData(table_ds['ward_boundary'], True).read_data({'statename': states})
    extent_data: gpd.GeoDataFrame = ReadDBData(table_ds['grid_3_extent'], True).read_data({'statename': states})

    print("Starting Operations")
    state_ta_datasets: list[TADatasets] = []
    for state_name, state_code in tqdm(state_info.items(), desc='Generating TA'):
        try:
            logging.info(f"Generating settlement target area datasets for {state_name}")

            state_settlements = settlements.loc[settlements[admin.state]==state_name]
            state_data = state_boundaries.loc[state_boundaries['statename']==state_name]
            building_fp: gpd.GeoDataFrame = ReadDBData(table_ds['buildings_footprint'], True).read_data({'statename': [state_name]})
            state_extent = extent_data.loc[extent_data['statename']==state_name]

            ta_datasets: TADatasets = generate_ta_datasets(
                state_settlements,
                state_data,
                state_extent,
                building_fp,
                attribute_columns,
                state_name,
                unique_col,
            )

            state_ta_datasets.append(ta_datasets)

        except Exception as e:
            logging.error(f"{e} Error Encountered when Generating Target Area Datasets for {state_name}")
            print(f"Error Encountered when Generating Target Area Datasets for {state_name}.\n❌❌Process terminated.")
            break

    return compile_datasets(state_ta_datasets, unique_col, planned_list)


if __name__ == '__main__':
    from toolbox.spatial_mgr import  convert_to_geodata
    settlement_df = pd.read_excel(r"C:\Workspace\NEOC\IBRA\August Round\Compiled MLoS.xlsx")
    planned_settlement_df =  pd.read_excel(r"C:\Workspace\NEOC\IBRA\August Round\Compiled IBRA R2 Settlements.xlsx")

    settlements = convert_to_geodata(settlement_df, GeomColumns('latitude', 'longitude'))
    planned_settlement = convert_to_geodata(planned_settlement_df, GeomColumns('latitude', 'longitude'))

    settlements = settlements.loc[settlements['state_name'].isin(['Adamawa'])]
    planned_settlement = planned_settlement.loc[planned_settlement['state_name'].isin(['Adamawa'])]
    ta_datasets = generate_settlement_target_area(settlements, planned_settlement, Identifier.uuid)
    extent, gridded_ta, extent_subset, gridded_ta_subset = ta_datasets.voronoi, ta_datasets.gridded_ta, ta_datasets.voronoi_subset, ta_datasets.gridded_ta_subset
    folder = r"C:\Workspace\NEOC\IBRA\August Round"
    extent.to_file(f"{folder}\\target_area.gpkg", driver='GPKG', layer="settlement_extent_1")
    gridded_ta.to_file(f"{folder}\\target_area.gpkg", driver='GPKG', layer="gridded_settlement_extent_1")

    extent_subset.to_file(f"{folder}\\planned_target_area.gpkg", driver='GPKG', layer="settlement_extent_1")
    gridded_ta_subset.to_file(f"{folder}\\planned_target_area.gpkg", driver='GPKG', layer="gridded_settlement_extent_1")
