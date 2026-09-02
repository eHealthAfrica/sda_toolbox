// ORPHANED — no longer imported anywhere. TargetAreaPage.tsx dropped the
// map (kept only the summary cards + volume chart), and per that decision
// utils/gpkg.ts's Target Area reader (openGpkgLayer) stopped selecting or
// decoding geometry entirely — TargetAreaLayer no longer has a `geometries`
// field for this component to render. This file is left as an inert stub
// (rather than the full Leaflet component it used to be) purely so it keeps
// compiling; it does nothing and nothing depends on it.
//
// This session's tools can edit files on your machine but not delete them —
// please delete this file (src/frontend/src/components/targetArea/TargetAreaMap.tsx).
// It joins TracksLgaChart.tsx (components/compilerTracks/) as a second
// orphan from earlier in this session, left the same way for the same
// reason — both are safe to remove whenever you next touch this repo.
export {}
