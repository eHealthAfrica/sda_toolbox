import StatCard from '../common/StatCard'
import type { ValidateDipAnalysis } from '../../types/microplanValidate'

interface ValidateTitleCardsProps {
  analysis: ValidateDipAnalysis
}

// Row 1: composition counts (LGAs / Wards / Settlements / Field Teams).
// Row 2: the three validation-outcome cards, all amber-accented since all
// three surface problems rather than composition. "Unaccounted Teams" sums
// the Ward sheet's Team Count Validation shortfall (a count comparison,
// unaffected by team numbering). "Non-compliant Team Codes" sums the Missing
// Teams column, per the approved design — but verifying this during
// implementation (running dip_tools.py::get_missing_team_codes verbatim
// against real data) turned up a second, more serious backend issue beyond
// the LGA-vs-state numbering gap that explains the raw DIP sheet's 98%+ flag
// rate: get_missing_team_codes compares zero-padded ward team codes ("006")
// against un-padded numbers from the code range ("6"), so they never match
// regardless of correctness. Confirmed structural, not data-dependent — it
// flags all 225 of 225 wards here, including perfectly-staffed ones. The
// card and number are kept exactly as requested; the caveat box below
// explains both issues precisely rather than attributing everything to the
// numbering convention alone.
export default function ValidateTitleCards({ analysis }: ValidateTitleCardsProps) {
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatCard
          label="LGAs"
          value={analysis.lgaCount.toLocaleString()}
          accentColor="#2c5f9e"
          hint="see unaccounted teams by LGA below"
        />
        <StatCard
          label="Wards"
          value={analysis.wardCount.toLocaleString()}
          accentColor="#2c5f9e"
          hint={
            analysis.wardNameOnlyCount !== analysis.wardCount
              ? `${analysis.wardNameOnlyCount.toLocaleString()} distinct ward names — ${analysis.wardCount - analysis.wardNameOnlyCount} reused across different LGAs`
              : undefined
          }
        />
        <StatCard
          label="Settlements"
          value={analysis.settlementsCarried.toLocaleString()}
          accentColor="#2c5f9e"
          hint={
            analysis.settlementsDropped > 0
              ? `${analysis.settlementsDropped.toLocaleString()} excluded — no team or day recorded (see ingest note)`
              : undefined
          }
        />
        <StatCard
          label="Field Teams"
          value={analysis.fieldTeamCount.toLocaleString()}
          accentColor="#2c5f9e"
          hint="distinct LGA · Ward · Team-code groups in the DIP"
        />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard
          label="Unaccounted Teams"
          value={analysis.unaccountedTeams.toLocaleString()}
          accentColor="var(--color-warning)"
          hint={`fewer unique teams appeared in the DIP than were allocated — ${analysis.unaccountedTeamWards} wards, ${analysis.unaccountedTeamLgas} LGAs (Team Count Validation)`}
        />
        <StatCard
          label="Non-compliant Team Codes"
          value={analysis.nonCompliantTeamCodes.toLocaleString()}
          accentColor="var(--color-warning)"
          hint={`allocated code numbers never seen in any ward's DIP — ${analysis.nonCompliantTeamCodeWards} of ${analysis.wardCount} wards affected (Missing Teams). Backend comparison bug, not a reliable count — see note below`}
        />
        <StatCard
          label="Teams Missing Activity Days"
          value={`${analysis.teamsMissingDays.toLocaleString()} (${analysis.teamsMissingDaysPct.toFixed(0)}%)`}
          accentColor="var(--color-warning)"
          hint={`of ${analysis.fieldTeamCount.toLocaleString()} teams didn't record all 4 campaign days`}
        />
      </div>

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
          ⚠ Why the raw DIP sheet's "Team Code Validation" flags most rows, and why "Non-compliant Team Codes" is
          currently not a trustworthy number at all
        </div>
        These two are caused by two different backend issues, not one. <b>Team Code Validation</b> (the 98%+
        row-level flag rate) is a real numbering-convention mismatch: the Team Allocation file numbers teams{' '}
        <b>cumulatively across the whole state</b> (the first LGA alphabetically gets codes 1–N, the next ward
        continues where it left off, and so on through every LGA), while the compiled DIP numbers teams{' '}
        <b>locally within each LGA</b>, restarting at 1 for that LGA's first ward. Whichever LGA sorts first will
        have local numbering that happens to equal the state numbering — every other LGA's team codes are correct{' '}
        <i>local</i> numbers being checked against the wrong <i>global</i> range. <b>Non-compliant Team Codes</b> is
        a separate, more serious problem: its backend source (<code>get_missing_team_codes</code>) compares the
        ward's zero-padded team codes (e.g. "006") against un-padded numbers ("6") from the allocated range, so the
        two never match — <i>regardless of whether the ward is correctly staffed</i>. That's confirmed structural,
        not data-dependent: it flags all 225 of 225 wards here, including ones with perfect numbering and full
        staffing. Until that backend comparison is fixed, this card's number carries no real signal — it's shown
        because the Missing Teams column was asked for by name, not because it's currently informative.{' '}
        <b>Unaccounted Teams</b> and <b>Teams Missing Activity Days</b> compare <i>counts</i> rather than specific
        code numbers, so neither bug touches them — they're the reliable signals on this page.
      </div>
    </>
  )
}
