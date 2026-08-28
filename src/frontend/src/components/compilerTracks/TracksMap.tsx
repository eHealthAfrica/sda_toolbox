import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { TrackPoint } from '../../types/compilerTracks'

const NIGERIA_CENTROID: [number, number] = [9.082, 8.6753]

function trackIcon(): L.DivIcon {
  return L.divIcon({
    className: 'track-marker',
    html: '<span style="display:block;width:9px;height:9px;border-radius:50%;background:#2c5f9e;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(44,95,158,.4);"></span>',
    iconSize: [9, 9],
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function popupHtml(point: TrackPoint): string {
  const rows: [string, string][] = [
    ['Latitude', point.latitude.toFixed(5)],
    ['Longitude', point.longitude.toFixed(5)],
  ]
  if (point.speedMps !== null) rows.push(['Speed (m/s)', point.speedMps.toFixed(2)])
  if (point.gpsTimestamp) rows.push(['GPS timestamp', point.gpsTimestamp])
  return `<div style="font-size:12px;"><b>Track point</b><br/>${rows
    .map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`)
    .join('<br/>')}</div>`
}

// Same imperative-cluster-layer pattern as h2h/VisitationMap.tsx — Leaflet
// owns the marker DOM directly rather than going through react-leaflet's
// per-point reconciler, since a compiled tracks file can carry thousands of
// points. Every point rendered here already passed the backend's own
// filtering (see the caveat in types/compilerTracks.ts) — there is nothing
// "dropped" left to show alongside it.
function ClusterLayer({ points }: { points: TrackPoint[] }) {
  const map = useMap()
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true })
    clusterGroupRef.current = clusterGroup

    for (const point of points) {
      const marker = L.marker([point.latitude, point.longitude], { icon: trackIcon() })
      marker.bindPopup(popupHtml(point))
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

interface TracksMapProps {
  points: TrackPoint[]
}

export default function TracksMap({ points }: TracksMapProps) {
  const center: [number, number] =
    points.length === 0
      ? NIGERIA_CENTROID
      : [
          points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
          points.reduce((sum, p) => sum + p.longitude, 0) / points.length,
        ]

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 13, margin: '0 0 3px' }}>Compiled tracks map</h2>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Click any point for its attribute record — latitude, longitude, speed, and GPS timestamp, read directly off
        the response GeoPackage.
      </div>
      {points.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No plottable points came back — check that the tracks file has recognizable latitude/longitude columns.
        </div>
      ) : (
        <MapContainer center={center} zoom={7} style={{ height: 480, width: '100%', borderRadius: 8 }} scrollWheelZoom>
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
