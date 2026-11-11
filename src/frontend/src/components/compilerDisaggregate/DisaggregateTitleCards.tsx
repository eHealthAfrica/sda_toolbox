import StatCard from '../common/StatCard'
import type { DisaggregateResult } from '../../types/compilerDisaggregate'

interface DisaggregateTitleCardsProps {
  result: DisaggregateResult
}

// What each level groups on, and which admin values must be present for a row
// to land in a sheet (the backend builds State_LGA / State_LGA_Ward keys).
const GROUP_LABEL = { State: 'State', LGA: 'State · LGA', Ward: 'State · LGA · Ward' } as const
const MISSING_LABEL = { State: 'a State value', LGA: 'a State or LGA value', Ward: 'a State, LGA or Ward value' } as const

export default function DisaggregateTitleCards({ result }: DisaggregateTitleCardsProps) {
  const groupLabel = GROUP_LABEL[result.level]
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard
          label="Sheets generated"
          value={result.sheets.length.toLocaleString()}
          accentColor="#2c5f9e"
          hint={`one per distinct ${groupLabel} group — see the chart below`}
        />
        <StatCard
          label="Total records in original data"
          value={result.totalRecordsOriginal.toLocaleString()}
          accentColor="#2c5f9e"
          hint="counted from the uploaded file itself, before submission"
        />
      </div>

      {result.rowsMissingAdminValue > 0 && (
        <div
          style={{
            background: '#fff2d6',
            border: '1px solid #f0d28c',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            marginBottom: 16,
            fontSize: 12,
            lineHeight: 1.65,
            color: '#5c4200',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: '#5c4200' }}>
            ⚠ {result.rowsMissingAdminValue.toLocaleString()} row{result.rowsMissingAdminValue === 1 ? '' : 's'} in the
            original upload {result.rowsMissingAdminValue === 1 ? 'is' : 'are'} missing{' '}
            {MISSING_LABEL[result.level]}
          </div>
          pandas' <code>groupby</code> — what this route uses to split by {groupLabel} —
          drops rows whose group key is missing entirely, by default. Those rows would not appear in any sheet, with
          nothing logged by the backend to say so. Computed here from the original upload, since the response
          workbook can't tell you this on its own.
        </div>
      )}
    </>
  )
}
