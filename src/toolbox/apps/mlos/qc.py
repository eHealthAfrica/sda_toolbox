# import io
# import os
# import tempfile
# import zipfile
# from pathlib import Path
#
# import uvicorn
# import pandas as pd
# import geopandas as gpd
# import numpy as np
# from fastapi import UploadFile, File, FastAPI, HTTPException
# from fastapi.responses import FileResponse
#
# from toolbox.utils import timer, logger
# from toolbox.access.read_mgr import read_dataset
# from toolbox.target_area.spatial_mgr import GeomColumns
# from toolbox.mlos.attr_builder import build_attributes
# from toolbox.review.spatial.spatial_checks import run_spatial_checks
# from toolbox.mlos import get_admin_col, detect_unique_admin_field, construct_new_unique
# from toolbox.review import (
#     find_duplicate_attributes,
#     validate_attributes_entry,
#     review_attributes_consistency,
#     duplicate_deep_search_protocol
# )
#
# import pyogrio  # Faster alternative to geopandas for reading shapefiles
# from concurrent.futures import ThreadPoolExecutor
# import asyncio
#
#
# logger(log_name='MLoS QC')
#
#
# def flag_settlements(settlement_data: pd.DataFrame, report_cols: list[str]):
#
#     query = " | ".join([f"({col}.notnull())" for col in report_cols])
#     settlement_data.eval(f"is_flagged={query}", engine='python', inplace=True)
#     settlement_data['is_flagged'] = settlement_data.apply(lambda row: "Flagged" if row['is_flagged'] else np.nan, axis=1)
#
#     return settlement_data
#
#
# @timer(title='MLoS Validation')
# # @app.post('/mlos', )
# async def validate_mlos(mlos_file_path: UploadFile, entries_check: bool, deep_search: bool=False):
#     """
#     Conduct QC on MLoS data including spatial and attributes checks
#
#     :param mlos_file_path: file path of the mlos data
#     :param entries_check: validate the attribute values are consistent with preset values
#     :param deep_search: execute an indepth search of duplicates
#     :return: None
#
#     """
#     # print(mlos_file_path.content_type)
#     data = await mlos_file_path.read()
#     content = io.StringIO(data.decode('utf-8'))
#     print(content.readlines()[0])
#     # v5_data: pd.DataFrame = read_dataset(str(mlos_file_path))
#     # state_col = get_admin_col(v5_data, 'state', 'ignore')
#     # if not state_col:
#     #     state_col = "state_name"
#     #     v5_data[state_col] = 'Kebbi'
#     #
#     # unique_col = detect_unique_admin_field(v5_data)
#     # if not unique_col:
#     #     unique_col = 'unique_code'
#     #     v5_data = construct_new_unique(v5_data, unique_col)
#     #
#     # main_columns: list = v5_data.columns
#     #
#     # geo_columns: GeomColumns = GeomColumns.get_geom_cols(v5_data, True)
#     # mlos_attribute = build_attributes(v5_data)
#     #
#     # print('Running QC Checks')
#     # attribute_checked = find_duplicate_attributes(v5_data, geo_columns, unique_col)
#     # spatially_checked = run_spatial_checks(attribute_checked, geo_columns, unique_col)
#     #
#     # if entries_check:
#     #     print('Running QC Checks on Attribute Entries')
#     #     entries_checked = validate_attributes_entry(spatially_checked, mlos_attribute)
#     #     entries_checked = review_attributes_consistency(entries_checked, mlos_attribute)
#     # else:
#     #     entries_checked = spatially_checked.copy(deep=True)
#     #
#     # if deep_search:
#     #     print('Running In-depth Duplicate check')
#     #     ward_col = get_admin_col(entries_checked, 'ward', error='raise')
#     #     final_checked = duplicate_deep_search_protocol(entries_checked, ward_col, unique_col, geo_columns)
#     # else:
#     #     final_checked = entries_checked.copy(deep=True)
#     #
#     # final_checked.drop(columns=['geometry', 'is_nearby', 'distance', 'index_right'], inplace=True, errors='ignore')
#     # report_columns = [col for col in final_checked if col not in main_columns]
#     # final_check = flag_settlements(final_checked, report_columns)
#     #
#     # # save_path = Path(mlos_file_path).parent
#     # # basename = Path(mlos_file_path).stem
#     # # final_check.to_csv(f'{save_path}\\{basename}_reviewed.csv', index=False)
#     # temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
#     # final_check.to_csv(temp_file.name, index=False)
#     # temp_file.close()
#
#     # Return the file as a response
#     # return FileResponse(
#     #     temp_file.name,
#     #     media_type="text/csv",
#     #     filename=f"{Path(mlos_file_path).stem}_processed.csv"
#     # )
#
#
# # Thread pool for CPU-bound operations
# executor = ThreadPoolExecutor(max_workers=4)
#
#
async def save_uploaded_file(upload_file: UploadFile, temp_dir: str):
    """Stream the upload to disk without loading entirely into memory"""
    zip_path = os.path.join(temp_dir, upload_file.filename)
    with open(zip_path, "wb") as f:
        while contents := await upload_file.read(1024 * 1024):  # 1MB chunks
            f.write(contents)
    return zip_path


def extract_and_find_shp(zip_path: str, temp_dir: str):
    """Extract zip and find .shp file (runs in thread pool)"""
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(temp_dir)

    for file in os.listdir(temp_dir):
        if file.endswith('.shp'):
            return os.path.join(temp_dir, file)
    return None


def read_shapefile(shp_path: str):
    """Read shapefile using pyogrio (faster than geopandas)"""
    return pyogrio.read_dataframe(shp_path)
#
#
# @app.post("/upload-shapefile/")
# async def upload_shapefile(zip_file: UploadFile = File(...)):
#     if not zip_file.filename.endswith('.zip'):
#         raise HTTPException(status_code=400, detail="Only ZIP files are accepted")
#
#     with tempfile.TemporaryDirectory() as temp_dir:
#         try:
#             # Step 1: Stream upload to disk
#             zip_path = await save_uploaded_file(zip_file, temp_dir)
#
#             # Step 2: Extract in thread pool
#             shp_path = await asyncio.get_event_loop().run_in_executor(
#                 executor, extract_and_find_shp, zip_path, temp_dir
#             )
#
#             if not shp_path:
#                 raise HTTPException(status_code=400, detail="No .shp file found")
#
#             # Step 3: Read shapefile in thread pool
#             gdf = await asyncio.get_event_loop().run_in_executor(
#                 executor, read_shapefile, shp_path
#             )
#
#             print(gdf)
#
#             return {
#                 "message": "Shapefile processed successfully",
#                 "feature_count": len(gdf),
#                 "crs": str(gdf.crs),
#                 "bbox": list(gdf.total_bounds),
#                 "columns": list(gdf.columns)
#                 # Omit geojson for large responses or implement streaming
#             }
#
#         except Exception as e:
#             raise HTTPException(status_code=500, detail=f"Error processing shapefile: {str(e)}")
#
#
# if __name__ == '__main__':
#     uvicorn.run(
#         'mlos:app',
#         port=9090,
#         log_level='info',
#         reload=True
#     )