import type { PreflightResult } from '../../types/dipMapMerger'

interface PreflightNoteCardProps {
  preflight: PreflightResult
}

// Computed entirely from the raw uploaded zips, before the request is even
// sent — see utils/dipMapMergerParse.ts::computePreflight. The backend
// response itself carries none of this: POST /dip/merger returns only the
// merged zip, nothing about what it matched or dropped along the way.
export default function PreflightNoteCard({ preflight }: PreflightNoteCardProps) {
  const unmatchedPct = preflight.totalDipPages + preflight.totalMapPages > 0
    ? (preflight.totalUnmatchedPages / (preflight.totalDipPages + preflight.totalMapPages)) * 100
    : 0

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
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Ingest note</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        What the two uploaded zips actually matched up before the merge ran — including team pages that couldn't be
        paired. Computed client-side from your files, not from the backend response.
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
        <NoteStat n={preflight.totalDipPages} label="DIP pages in the upload" />
        <NoteStat n={preflight.totalMapPages} label="Team Guide Map pages in the upload" />
        <NoteStat n={preflight.totalMatchedTeams} label="team pages successfully paired" />
        <NoteStat n={preflight.byLga.length} label="LGAs represented" />
      </div>
      {preflight.totalUnmatchedPages > 0 && (
        <div
          style={{
            marginTop: 12,
            background: '#fff2d6',
            border: '1px solid #f0d28c',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 11.5,
            color: '#7a4b00',
            lineHeight: 1.5,
          }}
        >
          ⚠ <b>
            {preflight.totalUnmatchedPages.toLocaleString()} page{preflight.totalUnmatchedPages === 1 ? '' : 's'} (
            {unmatchedPct.toFixed(1)}%) have no matching counterpart and will be silently dropped
          </b>{' '}
          — the backend only pairs a DIP page with a Team Guide Map page when exactly one of each shares the same
          filename suffix (<code>merger.py::arrange_pages</code>); anything with zero or more than one match is
          skipped with no error and no log entry. See the LGA table below for where these fall.
        </div>
      )}
    </div>
  )
}

function NoteStat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{n.toLocaleString()}</div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label}</div>
    </div>
  )
}
