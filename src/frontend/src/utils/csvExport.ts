import Papa from 'papaparse'

// Client-side-only CSV download — builds a Blob from the given rows and
// triggers a save via a throwaway <a download>. Used for the UUID batch
// checker's results export (no backend endpoint returns a file here, unlike
// H2H/MLoS which hand back a ready-made CSV/ZIP).
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
