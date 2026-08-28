import StatCard from '../common/StatCard'
import type { LgaDataPreflight } from '../../types/compilerLgaData'

interface LgaDataPreflightCardsProps {
  preflight: LgaDataPreflight
}

export default function LgaDataPreflightCards({ preflight }: LgaDataPreflightCardsProps) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <StatCard
        label="Per-LGA datasets found"
        value={preflight.datasets.length.toLocaleString()}
        accentColor="#2c5f9e"
        hint="computed by scanning the archive itself — see table below"
      />
      <StatCard
        label="Raw records across all datasets"
        value={preflight.totalRecords.toLocaleString()}
        accentColor="#fab219"
        hint="summed from the real files — before any server-side standardization or de-dup, which the route can't currently reach"
      />
    </div>
  )
}
