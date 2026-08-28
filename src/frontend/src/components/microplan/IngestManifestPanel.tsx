import type { ManifestEntry } from '../../types/microplan'

interface IngestManifestPanelProps {
  manifest: ManifestEntry[]
}

// Surfaces what the upload actually contained before showing any results —
// zip folders like this are easy to get subtly wrong. Grounded in a real
// finding against the sample COMPRESSED.zip: one archive
// (Kebbi_Argungu_November_2025.zip) was a re-zip of all 21 LGA folders
// nested one level deeper, not ward CSVs for Argungu, sitting alongside the
// correctly-named Argungu archive. A naive "unzip every .zip" loop would
// either double-count Argungu or (as parseDmpArchive does, since it finds no
// direct .csv entries inside) silently contribute nothing for that entry —
// either way, worth telling the user rather than hiding it.
export default function IngestManifestPanel({ manifest }: IngestManifestPanelProps) {
  const processed = manifest.filter((m) => m.status === 'processed')
  const skipped = manifest.filter((m) => m.status === 'skipped')
  const wardFilesRead = processed.reduce((sum, m) => sum + (m.wardFilesRead ?? 0), 0)

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Ingest manifest</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        What the upload actually contained — surfaced before the results, since zip folders like this are easy to get subtly wrong.
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
        <ManifestStat n={manifest.length} label="archives found" />
        <ManifestStat n={processed.length} label="LGA archives processed" />
        <ManifestStat n={wardFilesRead} label="ward CSV files read" />
        <ManifestStat n={skipped.length} label="archives skipped" />
      </div>
      {skipped.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {skipped.map((m) => (
            <div
              key={m.archiveName}
              style={{
                background: '#fff2d6',
                border: '1px solid #f0d28c',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: 11.5,
                color: '#7a4b00',
                lineHeight: 1.5,
              }}
            >
              ⚠ Skipped <b>{m.archiveName.split('/').pop()}</b> — {m.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ManifestStat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{n.toLocaleString()}</div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label}</div>
    </div>
  )
}
