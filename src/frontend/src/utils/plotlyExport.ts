import Plotly from 'plotly.js-basic-dist-min'
import JSZip from 'jszip'
import type { Data, Layout } from 'plotly.js'

// Generalized to a minimal structural interface rather than importing
// types/postImplementation.ts's own PostReport directly — Daily Report's
// PostReport (types/dailyReport.ts::DailyPostReport) has a differently-typed
// `level` union and an `lga: string | null` rather than `string`, but only
// `figure` and `save_name` are ever actually touched below, so either type
// satisfies this one structurally with no cast needed on either call site.
export interface ExportableReport {
  figure: { data: Data[]; layout: Partial<Layout> }
  save_name: string
}

// Every save_name the backend sends ends in ".png" (reporter.py builds it
// that way regardless of level) — reused as-is for the exported image's own
// filename, so a downloaded chart's name always matches what the backend
// itself would have called it.
const IMAGE_FORMAT = 'png' as const
const IMAGE_WIDTH = 900
const IMAGE_HEIGHT = 600

// PNG over JPEG: every report here is a pie or bar chart — flat fills, thin
// lines, and text labels, none of the smooth photographic gradients JPEG's
// DCT compression is built for. PNG's lossless compression handles large
// flat-color regions and crisp text edges more efficiently, so it comes out
// both lighter and artifact-free for this content; JPEG tends to bloat and
// visibly smear text at any reasonable quality on charts like these.

async function reportToImageBlob(report: ExportableReport): Promise<Blob> {
  const dataUrl = await Plotly.toImage(
    { data: report.figure.data, layout: report.figure.layout },
    { format: IMAGE_FORMAT, width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
  )
  const response = await fetch(dataUrl)
  return response.blob()
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Renders one report's Plotly figure to a PNG and downloads it directly — the chart table's per-row Download button. */
export async function downloadReportImage(report: ExportableReport): Promise<void> {
  const blob = await reportToImageBlob(report)
  triggerBlobDownload(blob, report.save_name)
}

/** Renders every report passed in to a PNG and zips them together in one download — the gallery's "Download all" button, once a filter narrows what's in view. */
export async function downloadReportsAsZip(reports: ExportableReport[], zipName: string): Promise<void> {
  const zip = new JSZip()
  const usedNames = new Set<string>()

  for (const report of reports) {
    const blob = await reportToImageBlob(report)
    // save_name is unique in practice (state + lga + level are baked into
    // it), but a zip entry collision would silently overwrite an earlier
    // file — guard it defensively rather than assume.
    let name = report.save_name
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.')
      const base = dot === -1 ? name : name.slice(0, dot)
      const ext = dot === -1 ? '' : name.slice(dot)
      let suffix = 2
      while (usedNames.has(`${base} (${suffix})${ext}`)) suffix++
      name = `${base} (${suffix})${ext}`
    }
    usedNames.add(name)
    zip.file(name, blob)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(zipBlob, zipName)
}
