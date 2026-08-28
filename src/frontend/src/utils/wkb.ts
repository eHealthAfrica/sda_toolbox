// Minimal GeoPackage-binary / WKB geometry decoder.
//
// UNVERIFIED AGAINST A REAL GEOPACKAGE FILE — same caveat as gpkg.ts. This
// sandbox has no network access to install sql.js or fetch a real
// /ta/generate_ta response, so this parser has only been checked against
// hand-built byte arrays that follow the spec below, not real GDAL/geopandas
// output. Treat it as a first pass; validate against a real response before
// relying on it for anything beyond a rough visual check.
//
// A GeoPackage geometry BLOB (OGC GeoPackage spec §2.1.3, "GeoPackageBinary
// header") is:
//   bytes 0-1   "GP" magic (0x47 0x50)
//   byte  2     version (0 = version 1)
//   byte  3     flags — bit 0: byte order (0=BE,1=LE) for header ints below;
//               bits 1-3: envelope indicator (0=none, 1=XY/32B, 2=XYZ/48B,
//               3=XYM/48B, 4=XYZM/64B); bit 4: empty-geometry flag
//   bytes 4-7   srs_id (int32, header byte order)
//   ...envelope bytes (per indicator above, doubles)
//   ...standard WKB geometry (ISO WKB, as GDAL/geopandas write for GPKG)
//
// Only Polygon and MultiPolygon (2D or with a Z/M dimension we skip over)
// are handled — the only geometry types voronoi/gridded-TA cells can be.
// Anything else returns null and the caller should skip that row rather
// than guess.

export type SimpleGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

interface Cursor {
  view: DataView
  offset: number
}

function readUint8(c: Cursor): number {
  const v = c.view.getUint8(c.offset)
  c.offset += 1
  return v
}

function readUint32(c: Cursor, le: boolean): number {
  const v = c.view.getUint32(c.offset, le)
  c.offset += 4
  return v
}

function readFloat64(c: Cursor, le: boolean): number {
  const v = c.view.getFloat64(c.offset, le)
  c.offset += 8
  return v
}

// WKB geometry type codes carry an optional dimension offset: plain 2D
// codes are 1-7; ISO WKB adds 1000 for Z, 2000 for M, 3000 for ZM; some
// writers (EWKB/PostGIS) instead set high bits 0x80000000 (Z) / 0x40000000
// (M) on the low 2D code. Handle both so we don't misparse a 3D polygon.
function decodeTypeCode(raw: number): { baseType: number; dims: 2 | 3 | 4 } {
  let type = raw
  let dims: 2 | 3 | 4 = 2
  if (type & 0x80000000) {
    dims = 3
    type &= ~0x80000000
  }
  if (type & 0x40000000) {
    dims = Math.max(dims, 3) as 3 | 4
    type &= ~0x40000000
  }
  if (type >= 3000) {
    dims = 4
    type -= 3000
  } else if (type >= 2000) {
    dims = Math.max(dims, 3) as 3 | 4
    type -= 2000
  } else if (type >= 1000) {
    dims = Math.max(dims, 3) as 3 | 4
    type -= 1000
  }
  return { baseType: type, dims }
}

function readRing(c: Cursor, le: boolean, dims: number): number[][] {
  const count = readUint32(c, le)
  const ring: number[][] = []
  for (let i = 0; i < count; i++) {
    const x = readFloat64(c, le)
    const y = readFloat64(c, le)
    for (let d = 2; d < dims; d++) readFloat64(c, le) // skip Z/M — we only render 2D
    ring.push([x, y])
  }
  return ring
}

function readPolygonRings(c: Cursor, le: boolean, dims: number): number[][][] {
  const ringCount = readUint32(c, le)
  const rings: number[][][] = []
  for (let i = 0; i < ringCount; i++) rings.push(readRing(c, le, dims))
  return rings
}

/** Parses a standalone WKB geometry (no GeoPackage header) into a SimpleGeometry, or null if unsupported/malformed. */
export function parseWkbGeometry(bytes: Uint8Array): SimpleGeometry | null {
  if (bytes.length < 5) return null
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const c: Cursor = { view, offset: 0 }
    const le = readUint8(c) === 1
    const { baseType, dims } = decodeTypeCode(readUint32(c, le))

    if (baseType === 3) {
      return { type: 'Polygon', coordinates: readPolygonRings(c, le, dims) }
    }

    if (baseType === 6) {
      const polyCount = readUint32(c, le)
      const polygons: number[][][][] = []
      for (let i = 0; i < polyCount; i++) {
        // Each member is itself a full WKB geometry (own byte-order + type header).
        const innerLe = readUint8(c) === 1
        const { dims: innerDims } = decodeTypeCode(readUint32(c, innerLe))
        polygons.push(readPolygonRings(c, innerLe, innerDims))
      }
      return { type: 'MultiPolygon', coordinates: polygons }
    }

    return null // Point/LineString/GeometryCollection etc. — not expected for TA layers
  } catch {
    return null // malformed/truncated blob — skip this row rather than throw
  }
}

/** Parses a full GeoPackage geometry BLOB (header + envelope + WKB) into a SimpleGeometry, or null. */
export function readGpkgGeometryBlob(bytes: Uint8Array): SimpleGeometry | null {
  if (bytes.length < 8 || bytes[0] !== 0x47 || bytes[1] !== 0x50) return null // not "GP"
  const flags = bytes[3]
  const isEmpty = (flags >> 4) & 0x01
  if (isEmpty) return null
  const envelopeIndicator = (flags >> 1) & 0x07
  const envelopeBytesByIndicator = [0, 32, 48, 48, 64]
  const envelopeBytes = envelopeBytesByIndicator[envelopeIndicator] ?? 0
  const wkbStart = 8 + envelopeBytes
  if (bytes.length <= wkbStart) return null
  return parseWkbGeometry(bytes.subarray(wkbStart))
}
