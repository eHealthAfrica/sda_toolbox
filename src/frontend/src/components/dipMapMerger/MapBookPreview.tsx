import { useEffect, useMemo, useState } from 'react'
import type { LgaBookStat } from '../../types/dipMapMerger'

interface MapBookPreviewProps {
  books: LgaBookStat[]
  selectedLga: string | null
  onSelect: (lga: string) => void
}

// Renders the actual returned PDF inline via an object URL built from its
// real bytes (utils/dipMapMergerParse.ts already extracted them out of the
// response zip) — no server round-trip needed to preview a book, and
// nothing here is a mockup image. The object URL is created/revoked as the
// selection changes so this doesn't leak memory across a long session.
export default function MapBookPreview({ books, selectedLga, onSelect }: MapBookPreviewProps) {
  const selectedBook = useMemo(
    () => books.find((b) => b.lga === selectedLga) ?? books[0] ?? null,
    [books, selectedLga]
  )
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedBook) {
      setObjectUrl(null)
      return
    }
    // Newer TypeScript DOM lib typings make Uint8Array's `.buffer` generic
    // over ArrayBufferLike (which also covers SharedArrayBuffer), which
    // BlobPart doesn't accept directly — .slice() first guarantees a fresh,
    // exactly-sized, plain ArrayBuffer regardless of how the source view
    // was created.
    const blob = new Blob([selectedBook.pdfBytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedBook])

  if (books.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Map book preview</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Pick any LGA to preview its merged map book inline before downloading the full zip.
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 240, flexShrink: 0 }}>
          <select
            value={selectedBook?.lga ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 9px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              marginBottom: 12,
            }}
          >
            {books.map((b) => (
              <option key={b.lga} value={b.lga}>
                {b.outputFilename} ({b.pages} pages, {b.teams} teams)
              </option>
            ))}
          </select>
          {selectedBook?.oddPageCount && (
            <div style={{ fontSize: 11, color: '#92680a', lineHeight: 1.5 }}>
              ⚠ Odd page count — at least one team's DIP page likely overflowed onto a 2nd sheet, so the team count
              above is an estimate for this LGA.
            </div>
          )}
        </div>
        <div
          style={{
            flex: '1 1 400px',
            minWidth: 300,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: '#525659',
          }}
        >
          {objectUrl ? (
            <iframe title="Map book preview" src={objectUrl} style={{ width: '100%', height: 480, border: 0, display: 'block' }} />
          ) : (
            <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5 }}>
              No book selected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
