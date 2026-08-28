import logging
import tempfile
from typing import Optional, Any

import geopandas as gpd
from fastapi import APIRouter, UploadFile, Form
from fastapi.responses import FileResponse

from toolbox.utils import atimer, logger
from toolbox.tools import generate_output_name, read_compiled_data
from toolbox.models import TriangulationMethod, State
from toolbox.triangulate import triangulating_reached_settlements
from toolbox.access.read_mgr import read_dataset
from toolbox.tracks_manager.tr import read_tracks
from toolbox.mlos import detect_unique_admin_field, construct_new_unique, get_admin_col

router = APIRouter()
logger(log_name='REACH Analysis')


@atimer
@router.post('/validation', name='REACH Analysis', tags=['Tracking'])
async def reach_analysis(
        planned_settlements: UploadFile, data_sources: UploadFile,
        tracks: Optional[UploadFile] = Form(None), method: TriangulationMethod = TriangulationMethod.BOTH):
    """
    Conduct Reach analysis using multiple datasets against the settlement list for a state.

    Parameters
    ----------
    planned_settlements: UploadFile
        MLoS or Planned Settlement list.<br>
    data_sources: list[UploadFile]
        external data sources to be used for reach analysis<br>
    # source_names
    #     names of the external data sources used in the order of their inclusion.<br>

    method: TriangulationMethod
    tracks: UploadFile
        GTS tracks<br>
        

    WARNING⚠️: Be sure to separate the names by a comma and in the same order that the data sources are inputted.
               Future versions may support other delimiters.

    Returns
    -------
        FileResponse
    """

    logging.info('Conducting REACH Analysis')

    print('Reading Datasets...')
    mlos_gdf: gpd.GeoDataFrame = await read_dataset(planned_settlements, False)
    state_col = get_admin_col(mlos_gdf, 'state')
    state_names = mlos_gdf[state_col].str.strip().str.title().unique().tolist()
    states = [State[s_name] for s_name in state_names]
    uniquecode = detect_unique_admin_field(mlos_gdf)
    if uniquecode is None:
        uniquecode = 'uniquecode'
        mlos_gdf = construct_new_unique(mlos_gdf, uniquecode)

    datasets: dict[str, Any] = await read_compiled_data(data_sources)
    if tracks is not None:
        datasets['GTS'] = await read_tracks(tracks, None)

    print('\nStarting REACH Analysis...')
    methods = [method] if method != TriangulationMethod.BOTH else [TriangulationMethod.COORDS, TriangulationMethod.SETTLEMENT]
    triangulated_list = triangulating_reached_settlements(mlos_gdf, datasets, methods, uniquecode, states)

    print('Cleaning Up Results...')
    dropping_cols = ['geometry']
    triangulated_list = triangulated_list.drop(columns=dropping_cols, errors='ignore')
    triangulated_list.sort_values(by=[uniquecode, 'reach'], ascending=True, inplace=True)

    print('Saving and Exporting to CSV')
    logging.info('Saving and Exporting to CSV')
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
    triangulated_list.to_csv(temp_file.name, index=False)
    temp_file.close()

    save_name = generate_output_name(planned_settlements.filename, 'csv', 'REACH')
    return FileResponse(
        temp_file.name,
        media_type="text/csv",
        filename=save_name
    )
