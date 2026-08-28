// Compiler · Combine LGA Data — POST /compiler/lga_data
// (toolbox/apps/aggregators/lga_data.py::combine_lga_data, lines 20-70).
// Meant to merge per-LGA validation datasets back into one combined,
// standardized dataset. `lga_file` is the only UploadFile; `file_extension`
// and `state` have no Form()/Query() annotation, so both resolve to Query
// params (same FastAPI inference documented in api/client.ts). `state` is
// accepted by the signature but never referenced in the function body — a
// genuinely dead parameter.
//
// ⚠ HEADLINE FINDING, carried over from design and unchanged by
// implementation — this route cannot complete successfully against
// realistic per-LGA data, for three independent, code-confirmed reasons:
//
//  1. Zip nesting is one level deeper than the route ever unzips. A real
//     per-LGA export (this session's COMPRESSED.zip) is a zip of per-LGA
//     ZIPS, each containing per-ward CSVs. tools/filters.py::
//     extract_and_find_file calls zipfile.extractall exactly ONCE, then
//     globs for the target extension — the per-LGA zips are extracted but
//     never opened themselves, so it finds ZERO files of the requested
//     extension. Confirmed by re-running the same extraction against the
//     real file during design. extract_and_find_file returns None.
//  2. That None immediately crashes the next line — access/read_mgr.py::
//     get_excel_sheet_names(None) tries to iterate None as a list of file
//     paths (openpyxl.load_workbook(lga_file) for lga_file in file_paths) —
//     an unconditional TypeError for this input shape.
//  3. Even past that, the format doesn't match what the code expects:
//     get_excel_sheet_names calls openpyxl.load_workbook() on every file,
//     which requires genuine .xlsx binary format — every real per-LGA file
//     in the sample checked is a plain .csv, which openpyxl cannot open at
//     all, independent of the nesting issue.
//  4. Even with a perfectly flat, perfectly valid .xlsx zip, the route
//     still fails on its own last line: it writes the merged CSV to
//     `temp_file.name` (a real tempfile path) but returns
//     `FileResponse(save_name, ...)` where `save_name =
//     generate_output_name(...)` — tools/helper.py's generate_output_name is
//     a plain string builder with NO file I/O at all. `save_name` is never
//     written to disk; FileResponse would try to serve a file that doesn't
//     exist, regardless of input shape.
//
// This page still makes the real call (submitCombineLgaData in
// api/client.ts) rather than faking a response — see LgaDataPage.tsx for
// how a failure is surfaced. What it does NOT do is pretend the request
// will succeed: the "records per dataset" preview below is computed
// entirely client-side, by walking the real uploaded archive, BEFORE the
// request is even sent — genuinely useful regardless of whether the backend
// call succeeds, and exactly how the design proposal's numbers were
// produced.

import type { StateName } from './h2h'

export interface LgaDataFormInput {
  lgaFile: File | null
  fileExtension: string
  state: StateName | ''
}

export interface PreflightDataset {
  /** The zip entry name this dataset came from (a per-LGA sub-zip, or a flat data file/sheet at the top level). */
  name: string
  /** Data files found inside this dataset (1 for a flat file, N for a per-LGA zip's ward files). */
  fileCount: number
  recordCount: number
}

export interface LgaDataPreflight {
  datasets: PreflightDataset[]
  totalRecords: number
}
