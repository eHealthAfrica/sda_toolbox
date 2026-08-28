import StatCard from '../common/StatCard'
import type { DipMapMergerAnalysis } from '../../types/dipMapMerger'

interface DipMergerTitleCardsProps {
  analysis: DipMapMergerAnalysis
}

// Team counts here come from halving each output PDF's real page count
// (utils/dipMapMergerParse.ts) — confirmed against merge_pdfs/arrange_pages,
// but not shown with the divide-by-2 notation since it reads as more
// uncertain than it is; the hints below spell out where the number comes
// from in words instead.
//
// "Incomplete Teams" reuses preflight.totalUnmatchedPages (computePreflight,
// same file) — the count of DIP/map pages that never found their one
// counterpart, computed from the raw uploaded zips before the request is
// even sent, since the backend response has no account of what it dropped
// (merger.py::arrange_pages silently `continue`s past them). In the
// overwhelmingly common case each unmatched page belongs to a distinct team,
// so this reads as "how many teams" as much as "how many pages"; the one
// edge case where it could overcount a single team is duplicate filenames
// sharing the same matching suffix on the map side, which the ingest note's
// per-LGA table below would also make visible.
export default function DipMergerTitleCards({ analysis }: DipMergerTitleCardsProps) {
  const oddCount = analysis.books.filter((b) => b.oddPageCount).length

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <StatCard
        label="LGAs Generated"
        value={analysis.lgaCount.toLocaleString()}
        accentColor="#2c5f9e"
        hint="one map book per LGA — see chart below"
      />
      <StatCard
        label="Output Pages"
        value={analysis.totalPages.toLocaleString()}
        accentColor="#2c5f9e"
        hint={`summed across all ${analysis.lgaCount.toLocaleString()} LGA map books`}
      />
      <StatCard
        label="Field Teams"
        value={analysis.totalTeams.toLocaleString()}
        accentColor="#2c5f9e"
        hint="one DIP page plus one map page per team"
      />
      <StatCard
        label="Incomplete Teams"
        value={analysis.preflight.totalUnmatchedPages.toLocaleString()}
        accentColor="var(--color-warning)"
        hint="DIP or map page with no matching counterpart — dropped by the backend, not merged; see the ingest note below"
      />
      <StatCard
        label="Avg Teams / LGA"
        value={analysis.avgTeamsPerLga.toLocaleString()}
        accentColor="#2c5f9e"
        hint={
          analysis.largestLga
            ? `${analysis.largestLga.lga} largest at ${analysis.largestLga.teams.toLocaleString()} teams`
            : undefined
        }
      />
      {oddCount > 0 && (
        <StatCard
          label="LGAs With Uneven Pages"
          value={oddCount.toLocaleString()}
          accentColor="var(--color-warning)"
          hint="odd page count — at least one team's DIP likely overflowed onto a 2nd page (see design notes)"
        />
      )}
    </div>
  )
}
