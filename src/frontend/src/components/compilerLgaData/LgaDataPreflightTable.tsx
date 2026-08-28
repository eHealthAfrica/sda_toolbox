import type { LgaDataPreflight } from '../../types/compilerLgaData'

interface LgaDataPreflightTableProps {
  preflight: LgaDataPreflight
}

export default function LgaDataPreflightTable({ preflight }: LgaDataPreflightTableProps) {
  const sorted = [...preflight.datasets].sort((a, b) => b.recordCount - a.recordCount)
  const maxRecords = Math.max(1, ...sorted.map((d) => d.recordCount))

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Records per dataset</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        One row per per-LGA zip (or flat file) found inside the upload, largest first — computed by walking the real
        archive client-side.
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No datasets were found in this archive.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Dataset', 'Files', 'Records', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    color: 'var(--color-text-muted)',
                    fontWeight: 600,
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.name} style={d.recordCount === 0 ? { background: '#fef7f7' } : undefined}>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>{d.name}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>{d.fileCount}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 100, height: 7, background: '#eef0f2', borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.round((d.recordCount / maxRecords) * 100)}%`,
                          background: '#2c5f9e',
                          borderRadius: 5,
                        }}
                      />
                    </div>
                    {d.recordCount.toLocaleString()}
                  </div>
                </td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                  {d.recordCount === 0 ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: 20,
                        fontSize: 10.5,
                        fontWeight: 600,
                        background: '#fbe6e6',
                        color: 'var(--color-critical)',
                      }}
                    >
                      ⚠ empty
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: 20,
                        fontSize: 10.5,
                        fontWeight: 600,
                        background: '#e6f6e6',
                        color: 'var(--color-good)',
                      }}
                    >
                      ✓ usable
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
