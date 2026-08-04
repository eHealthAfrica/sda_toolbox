import tempfile
from typing import Literal
from datetime import datetime

import pandas as pd
import geopandas as gpd
from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from toolbox.access.read_mgr import read_dataset
from toolbox.reporting import execute_timespent_analysis

router = APIRouter()


@router.post('/reports/timespent', tags=['Reports'])
async def timespent_analysis(
        tracks_dataset: UploadFile, output: Literal['table', 'chart'],
        track_date: datetime|str=None, interval_hr: int=1):

    """
    Carry out timespent analysis based on GTS tracks data

    Parameters
    ----------
    tracks_dataset: UploadFile<br>
        dataset containing GTS Tracks<br>

    output: Literal['table', 'chart']
        Specify the type of output result to return.<br>
            ``chart`` generates the final timespent chart.<br>
            ``table`` produces the resultant table allowing you to use any specialized software to make your own charts<br>

    track_date: str
        The Date str for which to conduct the timespent analysis. Use any ISO acceptable formats. Prefers YYYY-MM-DD

    interval_hr: int:
        Specify what intervals the chart should be based on. Default is 1 hr.

    Returns
    -------
        FileResponse: CSV or PNG file of timespent analysis
    """

    tracks_data: gpd.GeoDataFrame = await read_dataset(tracks_dataset, True)
    if track_date:
        today: datetime = track_date if isinstance(tracks_data, datetime) else datetime.fromisoformat(track_date)
    else:
        today = pd.Timestamp.today()

    result = execute_timespent_analysis(tracks_data, today, output, interval_hr)

    suffix_map = {
        'table': 'csv',
        'chart': 'png'
    }

    if isinstance(result, pd.DataFrame):
        writer = result.to_csv
    else:
        writer = result.write_image

    out_media = {
        'table': 'text/csv',
        'chart': 'image/png'
    }

    suffix = suffix_map.get(output)
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=f'.{suffix}')
    writer(tmp_file.name)
    tmp_file.close()

    return FileResponse(
        tmp_file.name,
        media_type=out_media.get(output),
        filename=f'timespent_analysis.{suffix}'

    )
