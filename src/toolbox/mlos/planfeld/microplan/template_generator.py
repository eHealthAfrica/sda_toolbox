import os
import warnings
import tempfile

import pandas as pd
from tqdm import tqdm
from pandas import DataFrame
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, A0
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

from toolbox.mlos.planfeld.microplan.mp_validator import validate_daily_implementation_plan
from toolbox.mlos.planfeld.microplan.dip_tools import TemplateFields, prepare_dip_data


warnings.filterwarnings(action='ignore')


class DIPTemplateGenerator:
    def __init__(self, df: pd.DataFrame, fields: TemplateFields):
        self.df = df
        self.fields = fields
        self.days = ["1", "2", "3", "4"]
        self.row_labels = [
            "Name of Settlements",
            "Settlement Category",
            "Number of Households",
            "Name of the First Household owner with landmarks (Start point)",
            "Via /Midpoint / Landmark",
            "Name of the Last household Owner with landmarks (End point)",
            "Take-off point"
        ]

    def export_all_teams(self):
        unique_teams = self.df['unique_team_code'].unique()
        teams_group = self.df.groupby('unique_team_code')
        team_dip_files: list[str] = []
        with tempfile.TemporaryDirectory(delete=False, ignore_cleanup_errors=True) as tmpdir:
            print(f"Generating DIPs for {len(unique_teams)} teams...")
            for unique_team_code, team_data in tqdm(teams_group):
                dip_file = self.generate_team_pdf(unique_team_code, team_data, tmpdir)
                team_dip_files.append(dip_file)

            print("\nAll DIPs Generated successfully.")
            return team_dip_files

    def generate_team_pdf(self, unique_team_code: str, team_df: pd.DataFrame, output_folder: str) -> str:
        lga, ward, team_code = unique_team_code.split("_")

        team_df['Day_List'] = (team_df[self.fields.activity_days]
                               .str.replace('Day ', '', case=False)
                               .str.split(','))

        exploded = team_df.explode('Day_List')
        exploded['Day_List'] = exploded['Day_List'].str.strip()

        meta = team_df.iloc[0]
        filename = f"DIP of Team {team_code} {ward} ward, {lga} LGA.pdf".replace("/", " ")
        output_file = os.path.join(output_folder, filename)

        # A0 usable width is ~3170pt
        doc = SimpleDocTemplate(
            output_file, pagesize=landscape(A0), topMargin=80, leftMargin=100, rightMargin=100, bottomMargin=80)

        elements = []
        styles = getSampleStyleSheet()

        # --- Adjusted Upscaled Styles for A0 ---
        title_style = ParagraphStyle('A0Title', parent=styles['Title'], fontSize=54, leading=70)
        label_style = ParagraphStyle('A0Label', parent=styles['Normal'], fontSize=26, leading=34)

        # Increased leading (line height) for Meta lines to prevent overlap
        meta_style_l = ParagraphStyle('A0ML', parent=styles['Normal'], fontSize=30, alignment=TA_LEFT, leading=45)
        meta_style_c = ParagraphStyle('A0MC', parent=styles['Normal'], fontSize=30, alignment=TA_CENTER, leading=45)
        meta_style_r = ParagraphStyle('A0MR', parent=styles['Normal'], fontSize=30, alignment=TA_RIGHT, leading=45)

        cell_style = ParagraphStyle('A0Cell', parent=styles['Normal'], fontSize=24, alignment=TA_CENTER, leading=32)
        header_cell_style = ParagraphStyle('A0Header', parent=styles['Normal'], fontSize=32, alignment=TA_CENTER, fontName='Helvetica-Bold')

        # 1. Title
        elements.append(
            Paragraph(
                "<b>Digital Daily Implementation Work Plan - House to House Vaccination Team</b>",
                title_style
            )
        )
        elements.append(Spacer(1, 60)) # Bigger spacer after title

        # 2. Header Table (Full Width Spacing)
        meta_table = Table([
            [Paragraph(f"<b>State:</b> {meta[self.fields.state]}", meta_style_l),
             Paragraph(f"<b>LGA:</b> {meta[self.fields.lga]}", meta_style_c),
             Paragraph(f"<b>Ward:</b> {meta[self.fields.ward]}", meta_style_r)],
            [Paragraph(f"<b>Team Supervisor Name:</b> ____________________", meta_style_l),
             Paragraph(f"<b>Team Code:</b> {team_code}", meta_style_c),
             Paragraph(f"<b>Team Supervisor Phone No:</b> ____________________", meta_style_r)]
        ], colWidths=[1056, 1058, 1056])

        meta_table.setStyle(TableStyle([
            ('LEFTPADDING', (0 ,0), (-1 ,-1), 0),
            ('RIGHTPADDING', (0 ,0), (-1 ,-1), 0),
            ('TOPPADDING', (0 ,0), (-1 ,-1), 15), # Space between the two meta rows
            ('BOTTOMPADDING', (0 ,0), (-1 ,-1), 15),
            ('VALIGN', (0 ,0), (-1 ,-1), 'MIDDLE'),
        ]))



        elements.append(meta_table)
        elements.append(Spacer(1, 60)) # Bigger spacer before main table

        # 3. Main Table Dimensions
        param_col_w = 800
        day_col_w = 592.5

        table_data = [[Paragraph("Parameters", header_cell_style),
                       Paragraph("Day 1", header_cell_style),
                       Paragraph("Day 2", header_cell_style),
                       Paragraph("Day 3", header_cell_style),
                       Paragraph("Day 4", header_cell_style)]]

        for r_idx, label in enumerate(self.row_labels[:-1]):
            row = [Paragraph(label, label_style)]
            self._create_records_rows(cell_style, day_col_w, exploded, r_idx, row)

            table_data.append(row)

        # 4. Final Row: Take-off Point
        unique_takeoffs = ", ".join(sorted(team_df[self.fields.takeoff].astype(str).unique()))
        table_data.append([Paragraph("Take-off point", label_style),
                           Paragraph(unique_takeoffs, cell_style), "", "", ""])

        # 5. Global Table Styling (Scaled up)
        t = Table(table_data, colWidths=[param_col_w, day_col_w, day_col_w, day_col_w, day_col_w])
        t.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 3, colors.black),
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('SPAN', (1, -1), (-1, -1)),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 35),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 35),
        ]))

        elements.append(t)
        doc.build(elements)
        return output_file

    def _create_records_rows(self, cell_style: ParagraphStyle, day_col_w: float,
                             exploded: DataFrame, r_idx: int, row: list[Paragraph]):

        id_map = {
            0: self.fields.settlement,
            1: self.fields.category,
            2: self.fields.households
        }

        for d in self.days:
            day_data = exploded[exploded['Day_List'] == d]

            if day_data.empty:
                row.append("")
            else:
                num_settlements = len(day_data)
                inner_col_width = day_col_w / num_settlements

                inner_cells = []
                for _, s_row in day_data.iterrows():
                    field = id_map.get(r_idx, None)
                    val = s_row[field] if field in s_row else ""
                    val = val if isinstance(val, str) else f"{val}"
                    inner_cells.append(Paragraph(val, cell_style))

                inner_table = Table([inner_cells], colWidths=[inner_col_width] * num_settlements)
                inner_table.setStyle(TableStyle([
                    ('GRID', (0, 0), (-1, -1), 2, colors.grey),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 10),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                ]))
                row.append(inner_table)


def generate_team_dips(dataset: pd.DataFrame, validate: bool=False, allocation_df: pd.DataFrame=None) -> tuple[dict[str, pd.DataFrame], list[str]]:
    if validate:
        validation_results, template_fields = validate_daily_implementation_plan(dataset, allocation_df, referred=True)
        exports: list[str] = DIPTemplateGenerator(validation_results['dip'], template_fields).export_all_teams()
        return validation_results, exports

    dip_data, template_fields = prepare_dip_data(dataset)
    exports: list[str] = DIPTemplateGenerator(dip_data, template_fields).export_all_teams()
    return {'dip': dip_data}, exports
