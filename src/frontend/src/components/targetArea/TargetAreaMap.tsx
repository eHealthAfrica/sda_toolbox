import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { TargetAreaLayer } from '../../types/targetArea'
import type { SimpleGeometry } from '../../utils/wkb'
import { detectColumns } from '../../utils/columns'

const NIGERIA_CENTROID: [number, number] = [9.082, 8.6753]

type LayerKey = 'voronoi' | 'griddedTa' | 'subsetVoronoi' | 'griddedTaSubset'

interface LayerMeta {
  key: LayerKey
  label: string
  color: string
  defaultOn: boolean
  plannedListOnly: boolean
}

// subsetVoronoi/griddedTaSubset only ever have data when a planned_list file
// was posted (see types/targetArea.ts) — their checkboxes are disabled
// rather than hidden when hasPlannedList is false, so it's visible in the UI
// that those layers exist but weren't produced for this run.
const LAYER_META: LayerMeta[] = [
  { key: 'voronoi', label: 'Voronoi extent', color: '#4a86e8', defaultOn: true, plannedListOnly: false },
  { key: 'griddedTa', label: 'Gridded TA', color: '#8e44ad', defaultOn: false, plannedListOnly: false },
  { key: 'subsetVoronoi', label: 'Planned settlements — voronoi', color: '#16a596', defaultOn: false, plannedListOnly: true },
  { key: 'griddedTaSubset', label: 'Planned settlements — gridded TA', color: '#d03b3b', defaultOn: false, plannedListOnly: true },
]

// Minimal local GeoJSON-shaped types (rather than depending on @types/geojson
// being pulled in transitively) — just enough structure for L.geoJSON to
// consume via an `any` cast at the call site.
interface TAFeature {
  type: 'Feature'
  geometry: SimpleGeometry
  properties: Record<string, string | number | null>
}
interface TAFeatureCollection {
  type: 'FeatureCollection'
  features: TAFeature[]
}

function layerToFeatureCollection(layer: TargetAreaLayer | null): TAFeatureCollection | null {
  if (!layer || layer.geometries.length === 0) return null
  const columns = detectColumns(layer.columns)
  const features: TAFeature[] = []
  layer.records.forEach((record, i) => {
    const geometry = layer.geometries[i]
    if (!geometry) return
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        state: columns.state ? record[columns.state] : null,
        lga: columns.lga ? record[columns.lga] : null,
        ward: columns.ward ? record[columns.ward] : null,
        settlement: columns.settlement ? record[columns.settlement] : null,
        type: (record.type as string | number | null | undefined) ?? null,
      },
    })
  })
  return features.length > 0 ? { type: 'FeatureCollection', features } : null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function popupHtml(properties: Record<string, string | number | null>): string {
  const rows: [string, string | number][] = [
    ['Settlement', properties.settlement ?? ''],
    ['Ward', properties.ward ?? ''],
    ['LGA', properties.lga ?? ''],
    ['State', properties.state ?? ''],
    ['Type', properties.type ?? ''],
  ].filter(([, value]) => value !== '' && value != null) as [string, string | number][]
  if (rows.length === 0) return ''
  return rows.map(([label, value]) => `<div><b>${label}:</b> ${escapeHtml(String(value))}</div>`).join('')
}

// Mirrors the imperative-layer pattern in h2h/VisitationMap.tsx's
// ClusterLayer — an L.GeoJSON layer is owned by Leaflet directly rather than
// rendered through react-leaflet's declarative components, since we're
// toggling visibility rather than diffing individual features.
function GeoJsonToggleLayer({ data, color, visible }: { data: TAFeatureCollection | null; color: string; visible: boolean }) {
  const map = useMap()
  const layerRef = useRef<L.GeoJSON | null>(null)

  useEffect(() => {
    if (!data) {
      layerRef.current = null
      return
    }
    const layer = L.geoJSON(data as any, {
      style: { color, weight: 1.2, fillColor: color, fillOpacity: 0.25 },
      onEachFeature: (feature, featureLayer) => {
        const html = popupHtml((feature.properties ?? {}) as Record<string, string | number | null>)
        if (html) featureLayer.bindPopup(html)
      },
    })
    layerRef.current = layer
  }, [data, color])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (visible) map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible, data, color])

  return null
}

function FitBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap()
  const fittedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!bounds || !bounds.isValid()) return
    const key = bounds.toBBoxString()
    if (fittedKey.current === key) return
    fittedKey.current = key
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [map, bounds])

  return null
}

interface TargetAreaMapProps {
  voronoi: TargetAreaLayer | null
  griddedTa: TargetAreaLayer | null
  subsetVoronoi: TargetAreaLayer | null
  griddedTaSubset: TargetAreaLayer | null
  hasPlannedList: boolean
}

export default function TargetAreaMap({ voronoi, griddedTa, subsetVoronoi, griddedTaSubset, hasPlannedList }: TargetAreaMapProps) {
  const dataByKey = useMemo<Record<LayerKey, TAFeatureCollection | null>>(
    () => ({
      voronoi: layerToFeatureCollection(voronoi),
      griddedTa: layerToFeatureCollection(griddedTa),
      subsetVoronoi: layerToFeatureCollection(subsetVoronoi),
      griddedTaSubset: layerToFeatureCollection(griddedTaSubset),
    }),
    [voronoi, griddedTa, subsetVoronoi, griddedTaSubset],
  )

  const [visibility, setVisibility] = useState<Record<LayerKey, boolean>>(() =>
    Object.fromEntries(LAYER_META.map((m) => [m.key, m.defaultOn])) as Record<LayerKey, boolean>,
  )

  function toggle(key: LayerKey) {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const anyGeometry = LAYER_META.some((meta) => dataByKey[meta.key] !== null)

  const boundsSource = dataByKey.voronoi ?? dataByKey.griddedTa ?? dataByKey.subsetVoronoi ?? dataByKey.griddedTaSubset
  const bounds = useMemo<L.LatLngBounds | null>(() => {
    if (!boundsSource) return null
    const b = L.geoJSON(boundsSource as any).getBounds()
    return b.isValid() ? b : null
  }, [boundsSource])

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        marginBottom: 24,
      }}
    >
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Target area map</h3>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        Decoded from the response ZIP's GeoPackage layers — geometry parsing is a first pass, unverified against a real
        backend response (see the disclosure in chat)
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        {LAYER_META.map((meta) => {
          const disabled = meta.plannedListOnly && !hasPlannedList
          return (
            <label
              key={meta.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
              title={disabled ? 'No planned list file was uploaded for this run' : undefined}
            >
              <input type="checkbox" checked={visibility[meta.key]} disabled={disabled} onChange={() => toggle(meta.key)} />
              <span style={{ width: 10, height: 10, borderRadius: 2, background: meta.color, display: 'inline-block' }} />
              {meta.label}
            </label>
          )
        })}
      </div>

      {!anyGeometry ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No renderable polygon geometry was found in the response — either this run produced no features, or the
          GeoPackage geometry decoder needs adjustment for this file (check the console for details).
        </div>
      ) : (
        <MapContainer center={NIGERIA_CENTROID} zoom={7} style={{ height: 480, width: '100%', borderRadius: 8 }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {LAYER_META.map((meta) => (
            <GeoJsonToggleLayer key={meta.key} data={dataByKey[meta.key]} color={meta.color} visible={visibility[meta.key]} />
          ))}
          <FitBounds bounds={bounds} />
        </MapContainer>
      )}
    </div>
  )
}
