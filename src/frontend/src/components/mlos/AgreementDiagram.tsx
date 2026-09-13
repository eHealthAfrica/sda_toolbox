import type { RowAgreement, SourceEvidence } from '../../types/coordinateReview'
import { AGREEMENT_RADIUS_M } from '../../utils/coordinateReviewAggregate'
import { sourceColor } from './CoordinateReviewSourcePanel'

interface AgreementDiagramProps {
  baseline: { latitude: number; longitude: number } | null
  evidenceBySource: Record<string, SourceEvidence | null>
  sourceNames: string[]
  analysis: RowAgreement
}

const SIZE = 56
const CENTER = SIZE / 2
const MAX_R = 20
// Distances beyond this are clamped to the edge of the diagram (direction
// preserved) so the plot stays legible regardless of how far a mismatched
// source actually is — the real distance is still in the evidence columns
// and the row's tooltip-free numbers, this is a quick visual only.
const MAX_METERS = 500

// Per-row mini scatterplot: the gray square is the ORIGINAL settlement
// point, fixed at the center; each colored dot is one matched source,
// positioned by real bearing/distance from that point (clamped per
// MAX_METERS above). A red line joins any two dots that belong to the
// row's agreeing cluster (see analyzeRow in utils/coordinateReviewAggregate.ts) —
// that's the visual the recommendation badge is based on. The dashed ring
// is the fixed agreement radius, for scale reference only.
export default function AgreementDiagram({ baseline, evidenceBySource, sourceNames, analysis }: AgreementDiagramProps) {
  if (!baseline) {
    return <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>No baseline coordinates</span>
  }

  const points: Record<string, [number, number]> = {}
  sourceNames.forEach((source) => {
    const ev = evidenceBySource[source]
    if (!ev) return
    const dLat = ev.latitude - baseline.latitude
    const dLon = ev.longitude - baseline.longitude
    const mx = dLon * 111320 * Math.cos((baseline.latitude * Math.PI) / 180)
    const my = -dLat * 110540 // invert so north is up
    const dist = Math.sqrt(mx * mx + my * my) || 0.0001
    const r = (Math.min(dist, MAX_METERS) / MAX_METERS) * MAX_R
    points[source] = [CENTER + (mx / dist) * r, CENTER + (my / dist) * r]
  })
  const ringR = (Math.min(AGREEMENT_RADIUS_M, MAX_METERS) / MAX_METERS) * MAX_R

  const clusterLines: { key: string; a: [number, number]; b: [number, number] }[] = []
  analysis.cluster.forEach((s, i) => {
    analysis.cluster.slice(i + 1).forEach((t) => {
      const a = points[s]
      const b = points[t]
      if (a && b) clusterLines.push({ key: `${s}-${t}`, a, b })
    })
  })

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <circle cx={CENTER} cy={CENTER} r={ringR} fill="none" stroke="var(--color-border)" strokeDasharray="2,2" />
      {clusterLines.map(({ key, a, b }) => (
        <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--color-critical)" strokeWidth={1.5} />
      ))}
      <rect x={CENTER - 3} y={CENTER - 3} width={6} height={6} fill="#4a4f5e" stroke="#fff" strokeWidth={1} />
      {Object.entries(points).map(([source, [x, y]]) => (
        <circle key={source} cx={x} cy={y} r={4} fill={sourceColor(sourceNames, source)} stroke="#fff" strokeWidth={1}>
          <title>{source}</title>
        </circle>
      ))}
    </svg>
  )
}
