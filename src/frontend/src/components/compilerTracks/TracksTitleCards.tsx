import StatCard from '../common/StatCard'
import type { TracksOriginalCount } from '../../types/compilerTracks'

interface TracksTitleCardsProps {
  count: number
  originalCount: TracksOriginalCount
}

// "Dropped Tracks" = originalCount.count − count, computed by the page from
// utils/compilerTracksOriginalCount.ts (a client-side count of the raw
// upload, taken before the request is sent) rather than re-implementing the
// backend's filter logic — see that file and types/compilerTracks.ts for why.
// Shows "—" instead of a number when the uploaded extension has no
// client-side parser (sqlite/kml/kmz) rather than guessing.
export default function TracksTitleCards({ count, originalCount }: TracksTitleCardsProps) {
  const dropped = originalCount.supported ? Math.max(0, originalCount.count - count) : null

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <StatCard
        label="Tracks compiled"
        value={count.toLocaleString()}
        accentColor="#2c5f9e"
        hint="points returned by the server after its own filtering — see the map below"
      />
      <StatCard
        label="Dropped Tracks"
        value={dropped !== null ? dropped.toLocaleString() : '—'}
        accentColor="var(--color-warning)"
        hint={
          dropped !== null
            ? 'points in your upload classified as invalid tracks by the server'
            : 'not available for this file type — only csv/xlsx/xls/gpkg uploads can be counted client-side'
        }
      />
    </div>
  )
}
