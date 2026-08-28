import { useEffect, useMemo, useState } from 'react'
import type { GeneratedTeamDip } from '../../types/dipGenerator'

interface TeamDipPreviewProps {
  teamDips: GeneratedTeamDip[]
  selectedFilename: string | null
  onSelect: (filename: string) => void
}

// Same real-object-URL pattern as dipMapMerger/MapBookPreview.tsx — renders
// the actual returned PDF bytes, not a mockup image.
export default function TeamDipPreview({ teamDips, selectedFilename, onSelect }: TeamDipPreviewProps) {
  const selected = useMemo(
    () => teamDips.find((t) => t.filename === selectedFilename) ?? teamDips[0] ?? null,
    [teamDips, selectedFilename]
  )
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) {
      setObjectUrl(null)
      return
    }
    // See MapBookPreview.tsx for why .slice().buffer is needed here — newer
    // TypeScript DOM typings make Uint8Array.buffer generic over
    // ArrayBufferLike, which BlobPart doesn't accept directly.
    const blob = new Blob([selected.pdfBytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selected])

  if (teamDips.length === 0) return null

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Team DIP preview</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Pick any generated team PDF to preview it inline before downloading the full zip.
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          <select
            value={selected?.filename ?? ''}
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
            {teamDips.map((t) => (
              <option key={t.filename} value={t.filename}>
                {t.filename}
              </option>
            ))}
          </select>
          {selected && (
            <table style={{ fontSize: 11.5, width: '100%' }}>
              <tbody>
                <MetaRow label="LGA" value={selected.lga} />
                <MetaRow label="Ward" value={selected.ward} />
                <MetaRow label="Team code" value={selected.teamCode} />
                <MetaRow label="Day(s)" value={selected.days?.join(', ') ?? '—'} />
                <MetaRow label="Pages" value={String(selected.pages)} />
              </tbody>
            </table>
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
            <iframe title="Team DIP preview" src={objectUrl} style={{ width: '100%', height: 420, border: 0, display: 'block' }} />
          ) : (
            <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5 }}>
              No team selected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '4px 0', color: 'var(--color-text-muted)', width: 90 }}>{label}</td>
      <td style={{ padding: '4px 0' }}>{value}</td>
    </tr>
  )
}
