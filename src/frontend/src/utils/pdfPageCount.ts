// Dependency-free PDF page counter. No PDF library is in package.json (the
// app already carries xlsx/jszip/sql.js for other formats — adding a whole
// PDF parser just to count pages felt like overkill), so this reads the raw
// bytes directly instead.
//
// Method: PDF page objects are plain-text dictionaries containing
// `/Type /Page` (never `/Type /Pages`, the container node) — for a classic,
// uncompressed-xref PDF like the ones this route produces (reportlab's
// SimpleDocTemplate output, concatenated by PyPDF2's PdfMerger — neither
// uses PDF 1.5+ compressed object streams by default), counting those
// matches gives an exact page count without parsing the object/xref
// structure at all.
//
// The one real risk: a Team Guide Map page's embedded raster image is a
// compressed binary stream, and a stream's bytes could — purely by chance —
// contain the same byte sequence as "/Type /Page" outside of any real PDF
// object. To rule that out, every `stream ... endstream` body is stripped
// before matching, so only genuine object-dictionary text is ever scanned.
//
// This does NOT handle PDFs using cross-reference streams / compressed
// object streams (PDF 1.5+, common from e.g. some scanner or Office
// exporters) — a page counted 0 despite non-trivial byte length is the
// signal that assumption doesn't hold for that file.
export function countPdfPages(bytes: Uint8Array): number {
  let text = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  const withoutStreams = text.replace(/stream\r?\n[\s\S]*?endstream/g, 'stream\nendstream')
  const matches = withoutStreams.match(/\/Type\s*\/Page(?!s)\b/g)
  return matches ? matches.length : 0
}
