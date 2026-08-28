import type { IngestNote } from '../../types/dipGenerator'

interface IngestNoteCardProps {
  note: IngestNote
}

// Computed from the raw uploaded file, before any batch is sent — see
// utils/dipGeneratorParse.ts::buildIngestNote. Mirrors prepare_dip_data's
// own drop condition (dip_tools.py, line 102-105): a row survives if EITHER
// the team column or the day-of-activity column is non-empty.
export default function IngestNoteCard({ note }: IngestNoteCardProps) {
  const pct = note.totalRows > 0 ? (note.rowsMissingBoth / note.totalRows) * 100 : 0

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
        What <code>prepare_dip_data</code> does to the upload before any PDF gets generated — this runs identically
        whether or not validation is switched on.
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
        <NoteStat n={note.totalRows} label="rows in the uploaded DIP" />
        <NoteStat n={note.distinctLgas} label="distinct LGAs detected" />
        <NoteStat text={note.lgaColumn ?? 'not found'} label="LGA column used for batching" />
        <NoteStat text={note.teamColumn ?? 'not found'} label="team column detected" />
        <NoteStat text={note.dayColumn ?? 'not found'} label="day-of-activity column detected" />
      </div>
      {note.rowsMissingBoth > 0 && (
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
            {note.rowsMissingBoth.toLocaleString()} row{note.rowsMissingBoth === 1 ? '' : 's'} ({pct.toFixed(1)}%)
            never reach a PDF at all
          </b>{' '}
          — any row with neither a team code nor a day of activity is filtered out by <code>prepare_dip_data</code>{' '}
          before teams are even grouped, silently and with no line in <code>DIP.csv</code> either.
        </div>
      )}
      {(!note.lgaColumn || !note.teamColumn || !note.dayColumn) && (
        <div
          style={{
            marginTop: 12,
            background: '#fbe6e6',
            border: '1px solid #f0b8b8',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 11.5,
            color: 'var(--color-critical)',
            lineHeight: 1.5,
          }}
        >
          ⚠ {!note.lgaColumn && "Couldn't detect an LGA column — batching will fall back to a single request for the whole file. "}
          {!note.teamColumn && "Couldn't detect a team column — the dropped-row count below may be inaccurate. "}
          {!note.dayColumn && "Couldn't detect a day-of-activity column — the dropped-row count below may be inaccurate, and per-team days won't show in the table."}
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
