import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { MapPoint } from '../../utils/aggregate'
import { UNKNOWN_COLOR, VISITATION_COLORS } from '../../utils/colors'
import type { VisitationStatus } from '../../types/h2h'

const NIGERIA_CENTROID: [number, number] = [9.082, 8.6753]

function statusIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'settlement-marker',
    html: `<span style="display:block;width:10px;height:10px;border-radius:50%;background:${color};border:1px solid rgba(0,0,0,0.3);"></span>`,
    iconSize: [10, 10],
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// Renders points as a clustered marker layer. Uses leaflet.markercluster
// directly (via useMap) rather than react-leaflet's declarative <Marker>
// per-point, since clustering thousands of settlement points through React's
// reconciler is both slower and unnecessary — Leaflet already owns this DOM.
function ClusterLayer({ points }: { points: MapPoint[] }) {
  const map = useMap()
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true })
    clusterGroupRef.current = clusterGroup

    for (const point of points) {
      const color = point.status === 'Unknown' ? UNKNOWN_COLOR : VISITATION_COLORS[point.status]
      const marker = L.marker([point.latitude, point.longitude], { icon: statusIcon(color) })
      const label = point.settlement ? escapeHtml(point.settlement) : 'Settlement'
      const locationParts = [point.lga, point.state]
        .filter((part): part is string => Boolean(part))
        .map(escapeHtml)
      marker.bindPopup(
        `<strong>${label}</strong>` +
          (locationParts.length ? `<br/>${locationParts.join(', ')}` : '') +
          `<br/>Status: ${escapeHtml(point.status)}`,
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
  }, [map, points])

  return null
}

function Legend({ order }: { order: VisitationStatus[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {order.map((status) => (
        <span
          key={status}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: VISITATION_COLORS[status],
              display: 'inline-block',
            }}
          />
          {status}
        </span>
      ))}
    </div>
  )
}

interface VisitationMapProps {
  points: MapPoint[]
  cumColumnLabel: string
  legendOrder: VisitationStatus[]
  // Same filter-banner convention as SettlementListTable — H2HTrackingPage
  // passes the already-filtered `points` here, plus a description so the map
  // shows why the marker count dropped and offers the same "Clear" escape
  // hatch as the table.
  filterDescription?: string | null
  onClearFilter?: () => void
  // When true, skip this component's own outer card (background/border/
  // shadow/padding) — used when a parent (TabbedPanel) already supplies one
  // shared frame for this and a sibling view (see H2HTrackingPage.tsx).
  bare?: boolean
}

export default function VisitationMap({
  points,
  cumColumnLabel,
  legendOrder,
  filterDescription,
  onClearFilter,
  bare,
}: VisitationMapProps) {
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
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Settlement visitation map</h3>
        <Legend order={legendOrder} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Colored by {cumColumnLabel} · {points.length.toLocaleString()} settlements plotted
      </div>

      {filterDescription && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#eaf1fb',
            border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            fontSize: 11.5,
            color: 'var(--color-primary)',
            marginBottom: 12,
          }}
        >
          <span>
            Filtered to <b>{filterDescription}</b>
          </span>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {points.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No plottable coordinates found in the result — check that the DIP file has latitude/longitude columns.
        </div>
      ) : (
        <MapContainer
          center={center}
          zoom={7}
          style={{ height: 480, width: '100%', borderRadius: 8 }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClusterLayer points={points} />
        </MapContainer>
      )}
    </div>
  )
}
