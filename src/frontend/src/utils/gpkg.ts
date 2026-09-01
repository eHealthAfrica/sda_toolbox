import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { readGpkgGeometryBlob } from './wkb'
import type { SimpleGeometry } from './wkb'

// A GeoPackage (.gpkg) file IS a plain SQLite database (that's the OGC
// GeoPackage spec) — sql.js (SQLite compiled to WASM) can open the raw bytes
// directly, no dedicated GPKG parser needed. readGpkgLayer below reads both
// the attribute columns AND the geometry column (decoding the latter's WKB
// via ../utils/wkb) — that's what Compiler Tracks (parseTracksGpkg) uses.
// openGpkgLayer further down is ATTRIBUTE-ONLY (no geometry at all) — that's
// what Target Area uses now that its map was removed; see the comment above
// openGpkgLayer for why.
//
// ⚠ Unverified against a real backend response: this repo's sandbox has no
// network access, so `sql.js` could not be installed or exercised against an
// actual .gpkg file produced by POST /ta/generate_ta while building this —
// same caveat as ../utils/wkb.ts's geometry decoder. The approach (open as
// SQLite, read gpkg_contents/gpkg_geometry_columns for the real table/column
// names, query via PRAGMA table_info) is standard for both technologies, but
// treat this file as a first pass to validate against a real response rather
// than something tested end-to-end like the CSV-parsing code elsewhere in
// this app.
//
// Operational note: sql.js needs its WASM binary served as a static asset,
// and this module is shared by every page that reads a GeoPackage response
// (Target Area's openTargetAreaZip AND Compiler Tracks' parseTracksGpkg),
// so a missing/wrong wasm breaks both at once. `npm install` does NOT put
// it there on its own (sql.js ships the
// wasm inside node_modules, not in this app's own public/), so it has to be
// copied in by hand — and it's not just one file:
//
// `import initSqlJs from 'sql.js'` resolves per sql.js's package.json
// `exports` map, which has a SEPARATE "browser" condition pointing at
// dist/sql-wasm-browser.js (not dist/sql-wasm.js, the one most sql.js docs/
// examples reference) — and Vite resolves that "browser" condition for both
// `npm run dev` and `vite build`. sql-wasm-browser.js's emscripten glue asks
// `locateFile` for `sql-wasm-browser.wasm` specifically, a different
// filename from `sql-wasm.wasm` (though byte-identical content — confirmed
// via md5sum against this sql.js version, 1.14.2). So public/ needs BOTH
// `sql-wasm.wasm` and `sql-wasm-browser.wasm` (both copied straight from
// node_modules/sql.js/dist/) to survive either resolution path.
//
// If GeoPackage parsing ever starts throwing `WebAssembly.instantiate():
// expected magic word ... found 3c 21 64 6f` again (that's "<!do" — the dev
// server's index.html being served for a missing /sql-wasm*.wasm instead of
// the real binary): check the Network tab for the exact wasm filename the
// failing request asked for, confirm that exact file exists in public/, and
// if sql.js was ever upgraded, re-copy both wasm files from
// node_modules/sql.js/dist/ (and re-check whether the "browser" condition
// still points at the same dist file, in case a future sql.js release
// renames it again).

let sqlJsPromise: Promise<SqlJsStatic> | null = null

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: (file) => `/${file}` })
  }
  return sqlJsPromise
}

export interface GpkgLayer {
  columns: string[]
  records: Record<string, string | number | null>[]
  rowCount: number
  /** Parsed geometry per row, aligned by index with `records`; null where a row's geometry was missing/unparseable. */
  geometries: (SimpleGeometry | null)[]
}

const EMPTY_LAYER: GpkgLayer = { columns: [], records: [], rowCount: 0, geometries: [] }

function isGeometryColumn(column: string): boolean {
  return /^geom(etry)?$/i.test(column)
}

function tableColumns(db: Database, tableName: string): string[] {
  const result = db.exec(`PRAGMA table_info("${tableName}")`)
  if (!result[0]) return []
  const nameIdx = result[0].columns.indexOf('name')
  return result[0].values.map((row) => String(row[nameIdx]))
}

// toolbox/access/export_mgr.py::create_spatial_sqlite writes each zip entry
// as a GPKG whose single feature layer is named identically to the zip
// entry itself (gdf.to_file(..., layer=table_name), with the same
// table_name string used as both the zip entry's file_name and db_name —
// see toolbox/apps/campaign/target_area.py's add_to_archive calls). Try that
// exact name first; fall back to gpkg_contents (the GeoPackage metadata
// table listing real feature table names) in case a geopandas/GDAL version
// ever mangles or truncates it.
function resolveTableName(db: Database, hint: string): string | null {
  try {
    db.exec(`SELECT 1 FROM "${hint}" LIMIT 1`)
    return hint
  } catch {
    // fall through
  }
  try {
    const contents = db.exec(`SELECT table_name FROM gpkg_contents WHERE data_type = 'features'`)
    const names = contents[0]?.values.map((row) => String(row[0])) ?? []
    return names[0] ?? null
  } catch {
    return null
  }
}

// The GeoPackage spec's gpkg_geometry_columns table declares the real
// geometry column name per feature table — more reliable than guessing by
// column name, though we still fall back to the name heuristic if that
// metadata table is missing or the query fails for any reason.
function resolveGeometryColumn(db: Database, tableName: string, allColumns: string[]): string | null {
  try {
    const result = db.exec('SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?', [tableName])
    const name = result[0]?.values?.[0]?.[0]
    if (name != null && allColumns.includes(String(name))) return String(name)
  } catch {
    // fall through to heuristic
  }
  return allColumns.find(isGeometryColumn) ?? null
}

export async function readGpkgLayer(bytes: Uint8Array, layerNameHint: string): Promise<GpkgLayer> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(bytes)
  try {
    const tableName = resolveTableName(db, layerNameHint)
    if (!tableName) return EMPTY_LAYER

    const allColumns = tableColumns(db, tableName)
    const geometryColumn = resolveGeometryColumn(db, tableName, allColumns)
    const attributeColumns = allColumns.filter((c) => c !== geometryColumn && !isGeometryColumn(c))

    const countResult = db.exec(`SELECT COUNT(*) FROM "${tableName}"`)
    const rowCount = countResult[0] ? Number(countResult[0].values[0][0]) : 0

    if ((attributeColumns.length === 0 && !geometryColumn) || rowCount === 0) {
      return { columns: attributeColumns, records: [], rowCount, geometries: [] }
    }

    const columnList = attributeColumns.map((c) => `"${c}"`).join(', ')
    const geomSelect = geometryColumn ? `${columnList ? ', ' : ''}"${geometryColumn}"` : ''
    const dataResult = db.exec(`SELECT ${columnList}${geomSelect} FROM "${tableName}"`)
    const resultSet = dataResult[0]
    if (!resultSet) return { columns: attributeColumns, records: [], rowCount, geometries: [] }

    const geomIdx = geometryColumn ? resultSet.columns.indexOf(geometryColumn) : -1
    const attrCols = geometryColumn ? resultSet.columns.filter((_, i) => i !== geomIdx) : resultSet.columns

    const records: Record<string, string | number | null>[] = []
    const geometries: (SimpleGeometry | null)[] = []
    resultSet.values.forEach((row) => {
      const record: Record<string, string | number | null> = {}
      resultSet.columns.forEach((col, i) => {
        if (i === geomIdx) return
        record[col] = row[i] as string | number | null
      })
      records.push(record)

      if (geomIdx >= 0) {
        const raw = row[geomIdx]
        geometries.push(raw instanceof Uint8Array ? readGpkgGeometryBlob(raw) : null)
      } else {
        geometries.push(null)
      }
    })

    return { columns: attrCols, records, rowCount, geometries }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Batched reader — added for Target Area's large multi-state results, where
// readGpkgLayer's single unbatched SELECT over every row was found to be the
// likely actual out-of-memory point (not just rendering). Deliberately a
// SEPARATE function rather than a change to readGpkgLayer above: Compiler
// Tracks (parseTracksGpkg) also calls readGpkgLayer and doesn't need this —
// keeping it additive means Tracks' behavior is untouched.
//
// ATTRIBUTE COLUMNS ONLY — no geometry. Target Area's map was removed (its
// only consumer of decoded polygon geometry — the summary cards/volume chart
// only ever read attribute records and row counts), so this deliberately
// never selects or decodes the geometry column at all: no WKB blob in the
// SQL result, no readGpkgGeometryBlob call, no coordinate-ring arrays held
// in memory. That's most of what TARGET_AREA_FOOTPRINT_MULTIPLIER in
// utils/browserMemory.ts used to account for — see that file for the
// updated (much lower) estimate now that this only ever holds plain
// string/number rows. The real spatial output is still fully available: the
// raw response ZIP (untouched by any of this) is what downloads, and it's
// the actual GeoPackages with real geometry — this function just never
// loads that geometry into the browser's own heap.
//
// Opens the GeoPackage once and keeps it open across multiple readBatch()
// calls (each a LIMIT/OFFSET query) rather than reopening per batch, so the
// one-time cost of loading the raw bytes into sql.js's own WASM heap is paid
// once per layer, not once per batch. Callers MUST call close() when done
// paging through a layer (including on an error/early-exit path) or that
// layer's WASM-side Database leaks for the life of the tab.

export interface GpkgLayerHandle {
  columns: string[]
  /** Total row count for this layer, from one SELECT COUNT(*) at open time — independent of how many rows any individual readBatch() call has returned so far. */
  rowCount: number
  /** Reads rows [offset, offset+limit) via LIMIT/OFFSET. Safe to call with an offset beyond rowCount (returns an empty array). */
  readBatch(offset: number, limit: number): { records: Record<string, string | number | null>[] }
  /** Frees the underlying sql.js Database. Idempotent — safe to call more than once. */
  close(): void
}

export async function openGpkgLayer(bytes: Uint8Array, layerNameHint: string): Promise<GpkgLayerHandle | null> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(bytes)

  const tableName = resolveTableName(db, layerNameHint)
  if (!tableName) {
    db.close()
    return null
  }

  const allColumns = tableColumns(db, tableName)
  // Still resolved, but only to EXCLUDE it from the SELECT below — the
  // geometry column itself is never read or decoded here.
  const geometryColumn = resolveGeometryColumn(db, tableName, allColumns)
  const attributeColumns = allColumns.filter((c) => c !== geometryColumn && !isGeometryColumn(c))

  const countResult = db.exec(`SELECT COUNT(*) FROM "${tableName}"`)
  const rowCount = countResult[0] ? Number(countResult[0].values[0][0]) : 0

  const selectCols = attributeColumns.map((c) => `"${c}"`).join(', ')
  const canSelect = attributeColumns.length > 0

  let closed = false

  function readBatch(offset: number, limit: number): { records: Record<string, string | number | null>[] } {
    if (closed) throw new Error(`readBatch called after close() on GpkgLayerHandle for "${tableName}"`)
    if (!canSelect || rowCount === 0 || offset >= rowCount) {
      return { records: [] as Record<string, string | number | null>[] }
    }

    const dataResult = db.exec(`SELECT ${selectCols} FROM "${tableName}" LIMIT ? OFFSET ?`, [limit, offset])
    const resultSet = dataResult[0]
    if (!resultSet) return { records: [] as Record<string, string | number | null>[] }

    const records: Record<string, string | number | null>[] = []
    resultSet.values.forEach((row) => {
      const record: Record<string, string | number | null> = {}
      resultSet.columns.forEach((col, i) => {
        record[col] = row[i] as string | number | null
      })
      records.push(record)
    })

    return { records }
  }

  return {
    columns: attributeColumns,
    rowCount,
    readBatch,
    close() {
      if (!closed) {
        closed = true
        db.close()
      }
    },
  }
}
