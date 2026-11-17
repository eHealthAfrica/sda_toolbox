import logging
from enum import StrEnum
from typing import Optional
from dataclasses import dataclass, field

import pandas as pd
from tqdm import tqdm
import geopandas as gpd

from toolbox.utils import timer
from toolbox.configs import CONFIG
from toolbox.access import ReadDBData
from toolbox.models import State, Policy
from toolbox.exceptions import DataError
from toolbox.spatial_mgr import GeomColumns
from toolbox.mlos.transformers.common import standardize_attribute_values
from toolbox.target_area import GeneratorDatasets, preview_settlements
from toolbox.target_area.run_summary import SkippedState, skip_reason, skipped_summary_text
from toolbox.target_area.v1.voronoi import build_state_voronoi
from toolbox.target_area.v1.gridded import build_settlement_grids
from toolbox.mlos import MLoSAttributes, AdminColumns, detect_unique_admin_field, construct_new_unique


@dataclass
class TADatasets:
    voronoi: gpd.GeoDataFrame
    gridded_ta: gpd.GeoDataFrame
    voronoi_subset: Optional[gpd.GeoDataFrame] = None
    gridded_ta_subset: Optional[gpd.GeoDataFrame] = None
    states_run: list[str] = field(default_factory=list)                 # states that produced a Target Area
    skipped_states: list[SkippedState] = field(default_factory=list)   # states left out, with the reason


class Identifier(StrEnum):
    concat = 'concat'
    uuid = 'uuid'


@timer
def generate_ta_datasets(gen_ds: GeneratorDatasets, columns: list[str], state: str) -> TADatasets:
    """Generates that Voronoi and Gridded TA Datasets"""
    logging.info(f"Generating Voronoi for {state}")
    state_settlement_voronoi = build_state_voronoi(
        gen_ds.settlement_data,
        gen_ds.voronoi_data,
        gen_ds.boundary_data,
        gen_ds.unique_column,
        state,
        columns
    )

    logging.info(f"Generating Gridded TA Datasets for {state}")
    state_gridded_ta = build_settlement_grids(
        state_settlement_voronoi,
        gen_ds.buildings_data,
        gen_ds.grids_data,
        gen_ds.unique_column
    )

    logging.info(f'Completed Target Area Operations for {state}')
    return TADatasets(voronoi=state_settlement_voronoi, gridded_ta=state_gridded_ta)


def compile_datasets(ta_datasets: list[TADatasets], unique_col: str, subset: gpd.GeoDataFrame=None) -> TADatasets:          # noqa
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
    subset_settlements: list = subset[unique_col].unique().tolist()
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
        The Complete State(s) Master List of Settlements

    planned_list: gpd.GeoDataFrame
        A Planned Subset of Settlements for different states

    unique_column: str
        The Unique column to be used to track and generated TA and Gridded TA datasets as well as extract
        planned settlements from total generated TAs

    Returns
    -------
        TADatasets: Target Area Datasets
    """

    geom: GeomColumns = GeomColumns.get_geom_cols(settlements, True)
    mlos = MLoSAttributes()(settlements, CONFIG['ATTRIBUTE_COLUMNS'], Policy.MLOS)
    admin = AdminColumns.create_by_search(settlements)
    unique_code: str | None = detect_unique_admin_field(settlements)
    if not unique_code:
        unique_code: str = 'unique_code'
        settlements = construct_new_unique(settlements, unique_code)                                                         # noqa

    settlements = standardize_attribute_values(
        settlements, [admin.state, admin.lga, admin.ward, admin.settlement], unique_code)

    settlements: gpd.GeoDataFrame = settlements.loc[settlements.geometry.y.notna()]                                          # noqa
    settlements.to_crs(CONFIG['PRJ_EPSG'], inplace=True)

    unique_col: str = mlos.global_id if unique_column==Identifier.uuid else unique_code                                      # noqa
    logging.info(f"Using {unique_col} for Operations")

    attribute_columns = [
        unique_code, mlos.global_id, admin.state, admin.lga, admin.ward, admin.settlement,
        geom.latitude, geom.longitude, 'type', mlos.numeric_attributes.set_target,                                          # noqa
        mlos.numeric_attributes.number_of_household, mlos.preset_attributes.accessibility_status                            # noqa
    ]

    table_ds: dict[str, str] = CONFIG['DATASETS']
    states: list[str] = settlements[admin.state].str.title().unique().tolist()
    state_info: dict[str, str] = {state: State[state].state_code for state in states}

    print(f"Fetching Database Layers for {len(states)} States: {', '.join(state_info.keys())} State(s)....")
    logging.info(f"Fetching Database Layers for {', '.join(state_info.keys())} State(s)....")
    state_boundaries: gpd.GeoDataFrame = ReadDBData(table_ds['ward_boundary'], True).read_data({'statename': states}) # noqa
    extent_data: gpd.GeoDataFrame = ReadDBData(table_ds['grid_3_extent'], True).read_data()    # noqa
    grids: gpd.GeoDataFrame = ReadDBData('grids', True).read_data({'statename': states})                    # noqa

    print("Starting Operations")
    state_ta_datasets: list[TADatasets] = []
    states_run: list[str] = []
    skipped_states: list[SkippedState] = []
    for state_name, state_code in tqdm(state_info.items(), desc='Generating TA'):
        try:
            logging.info(f"Generating settlement target area datasets for {state_name}")

            state_settlements = settlements.loc[settlements[admin.state].str.lower()==state_name.lower()]
            state_settlements = preview_settlements(state_settlements, mlos.global_id, unique_code)
            state_data = state_boundaries.loc[state_boundaries['statename']==state_name]
            state_grids = grids.loc[grids['statename']==state_name]
            building_fp: gpd.GeoDataFrame = ReadDBData(table_ds['obuildings'], True).read_data({'statename': [state_name]}) # noqa
            # building_fp: gpd.GeoDataFrame = gpd.read_file(r'C:\Workspace\DEV\Toolbox\src\dev\obuildings\sokoto_bds.gpkg') # noqa
            state_extent = extent_data.copy()
            ta_preq: GeneratorDatasets = GeneratorDatasets(
                unique_column=unique_col,
                settlement_data=state_settlements,
                boundary_data=state_data,
                voronoi_data=state_extent,
                grids_data=state_grids,
                buildings_data=building_fp
            )

            ta_datasets: TADatasets = generate_ta_datasets(ta_preq, attribute_columns, state_name)
            state_ta_datasets.append(ta_datasets)
            states_run.append(state_name)

        except Exception as e:
            reason = skip_reason(e)
            skipped_states.append(SkippedState(state_name, reason))
            logging.error(f"{state_name} skipped: {reason}", exc_info=True)
            print(f"Process Terminated for {state_name}")
            continue

    if not state_ta_datasets:
        raise DataError('Failed', f'No TA Datasets were generated. {skipped_summary_text(skipped_states)}'.strip())

    result = compile_datasets(state_ta_datasets, unique_col, planned_list)
    result.states_run = states_run
    result.skipped_states = skipped_states
    return result


if __name__ == '__main__':
    folder = r"C:\Workspace\NEOC\NIPDs\NOV ROUND\TA"
    from toolbox.spatial_mgr import  convert_to_geodata
    settlement_df = pd.read_excel(fr"{folder}\Target Area MLoS Settlements.xlsx")
    planned_settlement_df =  pd.read_excel(fr"{folder}\Target Area Planned Settlements.xlsx")

    settlements_data = convert_to_geodata(settlement_df, GeomColumns('latitude', 'longitude'))
    planned_settlements = convert_to_geodata(planned_settlement_df, GeomColumns('latitude', 'longitude'))

    ta_ds = generate_settlement_target_area(settlements_data, planned_settlements, Identifier.uuid)
    extent, gridded_ta, extent_subset, gridded_ta_subset = ta_ds.voronoi, ta_ds.gridded_ta, ta_ds.voronoi_subset, ta_ds.gridded_ta_subset
    extent.to_file(f"{folder}\\target_area.gpkg", driver='GPKG', layer="settlement_extent")
    gridded_ta.to_file(f"{folder}\\target_area.gpkg", driver='GPKG', layer="gridded_settlement_extent")

    extent_subset.to_file(f"{folder}\\planned_target_area.gpkg", driver='GPKG', layer="settlement_extent_1")        # noqa
    gridded_ta_subset.to_file(f"{folder}\\planned_target_area.gpkg", driver='GPKG', layer="gridded_settlement_extent_1")    # noqa
