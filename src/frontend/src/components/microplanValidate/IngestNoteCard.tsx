import type { ValidateDipAnalysis } from '../../types/microplanValidate'

interface IngestNoteCardProps {
  analysis: ValidateDipAnalysis
}

// Mirrors Microplan · Combine DMP Files' ingest manifest — always state what
// got left out, not just what got processed. The 155-settlement silent drop
// is a real finding (prepare_dip_data filters to rows where Team Code OR Day
// of Activity is present; rows with neither vanish before any review sheet
// is built), not a hypothetical, confirmed against the April Round files.
export default function IngestNoteCard({ analysis }: IngestNoteCardProps) {
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
        What the validator actually did with the upload before producing any review sheet — including what it silently left out.
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
        <NoteStat n={analysis.rawSettlementRows} label="settlement rows in the DIP" />
        <NoteStat n={analysis.settlementsCarried} label="carried into validation" />
        <NoteStat n={analysis.settlementsSplitAcrossTeams} label="settlements split across 2–5 teams" />
        <NoteStat text={`${analysis.wardsMatched} / ${analysis.wardCount}`} label="wards matched to Team Allocation" />
        <NoteStat n={analysis.wardsUnmatched} label="unmatched wards" />
      </div>
      {analysis.settlementsDropped > 0 && (
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
          ⚠ <b>{analysis.settlementsDropped.toLocaleString()} settlements ({((analysis.settlementsDropped / Math.max(1, analysis.rawSettlementRows)) * 100).toFixed(1)}%) were silently excluded</b> — they have neither a
          Team Code nor a Day of Activity recorded, so the validator drops them before validation even starts. They
          don't appear in the DIP, Ward, or Team review sheets at all.
        </div>
      )}
    </div>
  )
}

function NoteStat({ n, text, label }: { n?: number; text?: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{text ?? n?.toLocaleString()}</div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label}</div>
    </div>
  )
}
