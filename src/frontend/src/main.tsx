import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import App from './App'
import { JobTrackerProvider } from './state/jobTracker'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JobTrackerProvider>
      <App />
    </JobTrackerProvider>
  </React.StrictMode>,
)
