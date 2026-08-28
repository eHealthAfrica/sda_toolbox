from pathlib import Path

import pandas as pd
from tqdm import tqdm
from PyPDF2 import PdfMerger

from toolbox.tools import process_delimited_input, is_empty
from toolbox.access import ReadDBData
from toolbox.configs import CONFIG
from toolbox.models import State


def arrange_pages(set_1: list[Path], set_2: list[Path]) -> list[Path]:
    """Arrange Pages in Pairs of DIP and Catchment Map"""
    id_strs = [id_str.name.replace("DIP of ", "") for id_str in set_1]
    arranged_pages = []
    for id_str in id_strs:
        try:

            set_1_page = [page for page in set_1 if page.name.endswith(id_str)]
            set_2_page = [page for page in set_2 if page.name.endswith(id_str)]
            if len(set_1_page )!= 1 or len(set_2_page )!=1:
                continue

            arranged_pages.append(set_1_page[0])
            arranged_pages.append(set_2_page[0])

        except IndexError:
            raise IndexError(f"Issue with {id_str}")

    return arranged_pages


def merge_pdfs(pages_set1: list[Path], pages_set2: list[Path], output_filename):
    """Create PDF Mapbook"""

    # Create a PDF writer object
    merger = PdfMerger()
    sorted_pages = arrange_pages(pages_set1, pages_set2)

    try:
        for file in sorted_pages:
            merger.append(file.__str__())

        merger.write(output_filename)
        merger.close()

    except Exception as e:
        print(f"An error occurred: {e}")


def merge_maps_to_dips(dip_folder: str, maps_folder: str, tmp_dir: str, lgas: str = None, state: State = None) -> list:
    dip_folder, maps_folder = Path(dip_folder), Path(maps_folder)
    lga_maps_books = []
    if not is_empty(lgas):
        lga_names: list[str] = process_delimited_input(lgas)
    else:
        lga_data: pd.DataFrame = ReadDBData(
            CONFIG['DATASETS']['lga_boundary'], False).read_data({'statecode': state.state_code})
        lga_names = lga_data['lganame'].unique().tolist()

    for lga in tqdm(lga_names, desc="Generating LGA DIP Mapbook"):
        lga_pattern = f"{lga} LGA.pdf"
        lga_name = lga.replace('/', '-')
        lga_dips = list(dip_folder.rglob(f"*{lga_pattern}"))
        lga_maps = list(maps_folder.rglob(f"*{lga_pattern}"))
        lga_map_book = f"{str(tmp_dir)}\\{lga_name} Maps.pdf"
        merge_pdfs(lga_dips, lga_maps, lga_map_book)
        lga_maps_books.append(lga_map_book)

    return lga_maps_books
