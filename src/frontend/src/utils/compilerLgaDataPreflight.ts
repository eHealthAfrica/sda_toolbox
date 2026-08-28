import JSZip from 'jszip'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { LgaDataPreflight, PreflightDataset } from '../types/compilerLgaData'

const DATA_EXTENSIONS = ['csv', 'xlsx', 'xls']

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

async function countRows(name: string, bytes: Uint8Array): Promise<number> {
  const ext = extensionOf(name)
  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(bytes)
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
    return parsed.data.length
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(bytes, { type: 'array' })
    return workbook.SheetNames.reduce((sum, sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
      return sum + rows.length
    }, 0)
  }
  return 0
}

// Reads every data file inside one nested zip (a per-LGA export, in the
// real shape this route is meant for), at any depth — deliberately not
// limited to one extension, unlike the backend's own
// extract_and_find_file(..., extension), since the point of this preflight
// is to show what's ACTUALLY in the archive, not to reproduce the backend's
// single-extension, single-unzip-level bug.
async function analyzeNestedZip(name: string, bytes: Uint8Array): Promise<PreflightDataset> {
  let fileCount = 0
  let recordCount = 0
  try {
    const inner = await JSZip.loadAsync(bytes)
    const entries = Object.values(inner.files).filter((f) => !f.dir && DATA_EXTENSIONS.includes(extensionOf(f.name)))
    for (const entry of entries) {
      const entryBytes = await entry.async('uint8array')
      recordCount += await countRows(entry.name, entryBytes)
      fileCount += 1
    }
  } catch {
    // Malformed or unreadable nested zip — report it as a 0-record dataset
    // rather than failing the whole preflight (mirrors the real "empty
    // duplicate Argungu zip" found in this session's sample data).
  }
  return { name: baseName(name).replace(/\.zip$/i, ''), fileCount, recordCount }
}

async function analyzeFlatFile(name: string, bytes: Uint8Array): Promise<PreflightDataset> {
  const recordCount = await countRows(name, bytes)
  return { name: baseName(name), fileCount: 1, recordCount }
}

/**
 * Walks the real uploaded archive client-side, BEFORE the request is sent,
 * to answer "how many per-LGA datasets, and how many records each" — the
 * same question the design proposal's cards answered by hand against
 * COMPRESSED.zip. Computed independently of the `file_extension` the user
 * picked below, since that's exactly the parameter whose single-extension,
 * single-unzip-level handling is why the real backend call is expected to
 * fail (see types/compilerLgaData.ts for the full trace) — this preflight
 * exists precisely so the page still shows something honest and useful
 * either way.
 *
 * Handles both real-world shapes seen in this app: a zip of per-LGA ZIPS
 * (this session's real sample), and a flat zip of workbooks directly (the
 * shape the backend code actually assumes). A non-zip upload is treated as
 * one dataset on its own.
 */
export async function analyzeLgaDataArchive(file: File): Promise<LgaDataPreflight> {
  const ext = extensionOf(file.name)
  if (ext !== 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const dataset = await analyzeFlatFile(file.name, bytes)
    return { datasets: [dataset], totalRecords: dataset.recordCount }
  }

  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((f) => !f.dir)

  const nestedZipEntries = entries.filter((f) => extensionOf(f.name) === 'zip')
  const flatDataEntries = entries.filter((f) => DATA_EXTENSIONS.includes(extensionOf(f.name)))

  const datasets: PreflightDataset[] = []
  for (const entry of nestedZipEntries) {
    const bytes = await entry.async('uint8array')
    datasets.push(await analyzeNestedZip(entry.name, bytes))
  }
  for (const entry of flatDataEntries) {
    const bytes = await entry.async('uint8array')
    datasets.push(await analyzeFlatFile(entry.name, bytes))
  }

  const totalRecords = datasets.reduce((sum, d) => sum + d.recordCount, 0)
  return { datasets, totalRecords }
}
