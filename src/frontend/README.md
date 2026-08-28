# SDA Toolbox Frontend

React + TypeScript (Vite) frontend for the SDA Toolbox backend. This is the
first page of what's meant to grow into one page per endpoint — see the
sidebar in `App.tsx` for where the next ones plug in.

## Pages

### H2H Settlement Tracking (`/` — wraps `POST /tracking/gridded`)

Upload a planned-settlements (DIP) file and a GPS tracks file, set the
analysis day / mop-up flag / states, and run the backend's settlement
tracking analysis. The response ZIP is unzipped and parsed entirely in the
browser (via `jszip` + `papaparse`) — nothing is written to disk. Renders:

- Summary cards: total planned settlements, total states, total LGAs.
- Cards per `Settlement Coverage` category (Fully / Partially / Poorly
  Covered, No Coverage).
- Cards per visitation status (`day_{N}_cumm`: Visited / Not Yet Visited /
  Not Visited).
- A Leaflet map of every settlement with lat/lon, clustered and colored by
  visitation status.
- A bar chart of planned-settlement counts by LGA.
- A stacked bar chart of visitation status by state.

Because the settlements CSV's column names aren't fixed (they come from
whatever the uploaded DIP file used — the backend itself detects them by
fuzzy-matching), `src/utils/columns.ts` does the same detection client-side
rather than assuming literal column names like `State` or `Latitude`.

## Getting started

```bash
npm install
cp .env.example .env   # then edit VITE_API_BASE_URL to match how you run the backend
npm run dev
```

The backend needs CORS enabled for the dev server's origin — this was added
to `src/toolbox/sda_toolbox.py` alongside this frontend (see the comment
there). If you're running the backend some other way and requests are
blocked by the browser, check that its `allow_origins` includes wherever
this dev server is served from.

## Build

```bash
npm run build    # tsc -b && vite build -> dist/
npm run preview  # serve the production build locally
```
