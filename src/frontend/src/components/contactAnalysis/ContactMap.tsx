import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { ContactRecord } from '../../types/contactAnalysis'
import type { DetectedColumns } from '../../utils/columns'
import { toNumber } from '../../utils/columns'
import { UNKNOWN_COLOR, getContactCountColor } from '../../utils/colors'

const NIGERIA_CENTROID: [number, number] = [9.082, 8.6753]

interface ContactMapPoint {
  latitude: number
  longitude: number
  contact: number | null
  settlement: string | null
  lga: string | null
  state: string | null
}

function contactIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'settlement-marker',
    html: `<span style="display:block;width:10px;height:10px;border-radius:50%;background:${color};border:1px solid rgba(0,0,0,0.3);"></span>`,
    iconSize: [10, 10],
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// Same clustered-marker-layer pattern as reach/ReachMap.tsx and
// h2h/VisitationMap.tsx — Leaflet owns the DOM directly via useMap rather
// than routing thousands of points through react-leaflet's per-marker
// reconciler.
function ClusterLayer({ points, maxContact }: { points: ContactMapPoint[]; maxContact: number }) {
  const map = useMap()
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true })
    clusterGroupRef.current = clusterGroup

    for (const point of points) {
      const color = point.contact !== null ? getContactCountColor(point.contact, maxContact) : UNKNOWN_COLOR
      const marker = L.marker([point.latitude, point.longitude], { icon: contactIcon(color) })
      const label = point.settlement ? escapeHtml(point.settlement) : 'Settlement'
      const locationParts = [point.lga, point.state]
        .filter((part): part is string => Boolean(part))
        .map(escapeHtml)
      marker.bindPopup(
        `<strong>${label}</strong>` +
          (locationParts.length ? `<br/>${locationParts.join(', ')}` : '') +
          `<br/>Contact: ${point.contact !== null ? `${point.contact} of ${maxContact} rounds` : 'Unknown'}`,
      )
      clusterGroup.addLayer(marker)
    }

    map.addLayer(clusterGroup)

    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]))
      map.fitBounds(bounds, { padding: [24, 24] })
    }

    return () => {
      map.removeLayer(clusterGroup)
    }
  }, [map, points, maxContact])

  return null
}

function Legend({ maxContact }: { maxContact: number }) {
  const steps = Math.max(1, Math.min(maxContact, 5))
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {Array.from({ length: steps + 1 }, (_, i) => Math.round((i * maxContact) / steps)).map((contact) => (
        <span key={contact} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: getContactCountColor(contact, maxContact),
              display: 'inline-block',
            }}
          />
          {contact}
        </span>
      ))}
    </div>
  )
}

function textOrNull(record: ContactRecord, column: string | null): string | null {
  if (!column) return null
  const raw = record[column]
  if (raw === null || raw === undefined || raw === '') return null
  return String(raw)
}

interface ContactMapProps {
  records: ContactRecord[]
  columns: DetectedColumns
  maxContact: number
  contactColumn?: string
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see ContactAnalysisPage.tsx).
  bare?: boolean
}

// Point map graded by `contact` (count of previous-campaign rounds a
// settlement was recorded 'Visited' in), on the same continuous
// good/critical ramp as the count cards and by-group chart
// (utils/colors.ts::getContactCountColor) — scoped to whatever `records`
// the page's current state/LGA/ward drill selection has already filtered
// down to (see ContactAnalysisPage.tsx).
export default function ContactMap({ records, columns, maxContact, contactColumn = 'contact', bare }: ContactMapProps) {
  const points = useMemo<ContactMapPoint[]>(() => {
    if (!columns.latitude || !columns.longitude) return []
    const result: ContactMapPoint[] = []
    for (const record of records) {
      const lat = toNumber(record[columns.latitude])
      const lon = toNumber(record[columns.longitude])
      if (lat === null || lon === null) continue
      result.push({
        latitude: lat,
        longitude: lon,
        contact: toNumber(record[contactColumn]),
        settlement: textOrNull(record, columns.settlement),
        lga: textOrNull(record, columns.lga),
        state: textOrNull(record, columns.state),
      })
    }
    return result
  }, [records, columns, contactColumn])

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return NIGERIA_CENTROID
    const lat = points.reduce((sum, p) => sum + p.latitude, 0) / points.length
    const lon = points.reduce((sum, p) => sum + p.longitude, 0) / points.length
    return [lat, lon]
  }, [points])

  return (
    <div
      style={
        bare
          ? undefined
          : {
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: 16,
              marginBottom: 24,
            }
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 14 }}>Settlement contact map</h3>
        <Legend maxContact={maxContact} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Colored by contact (rounds visited, of {maxContact}) · {points.length.toLocaleString()} settlements plotted
      </div>

      {points.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No plottable coordinates found in the result — check that the file has latitude/longitude columns.
        </div>
      ) : (
        <MapContainer center={center} zoom={7} style={{ height: 480, width: '100%', borderRadius: 8 }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClusterLayer points={points} maxContact={maxContact} />
        </MapContainer>
      )}
    </div>
  )
}
