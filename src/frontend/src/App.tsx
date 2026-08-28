import { useState } from 'react'
import AppShell from './components/layout/AppShell'
import type { AppView } from './components/layout/AppShell'
import DashboardPage from './components/dashboard/DashboardPage'
import H2HTrackingPage from './components/h2h/H2HTrackingPage'
import MlosQcPage from './components/mlos/MlosQcPage'
import MlosOpsPage from './components/mlosOps/MlosOpsPage'
import UuidCheckerPage from './components/uuidChecker/UuidCheckerPage'
import ReachAnalysisPage from './components/reach/ReachAnalysisPage'
import ContactAnalysisPage from './components/contactAnalysis/ContactAnalysisPage'
import PostImplementationPage from './components/postImplementation/PostImplementationPage'
import TargetAreaPage from './components/targetArea/TargetAreaPage'
import MicroplanCombinePage from './components/microplan/MicroplanCombinePage'
import ValidateDipPage from './components/microplanValidate/ValidateDipPage'
import DipMergerPage from './components/dipMapMerger/DipMergerPage'
import DipGeneratorPage from './components/dipGenerator/DipGeneratorPage'
import TracksPage from './components/compilerTracks/TracksPage'
import DisaggregatePage from './components/compilerDisaggregate/DisaggregatePage'
import LgaDataPage from './components/compilerLgaData/LgaDataPage'
import DailyReportPage from './components/dailyReport/DailyReportPage'

const VIEW_META: Record<AppView, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'SDA Toolbox — EOC Analyst Workspace.',
  },
  h2h: {
    title: 'H2H Settlement Tracking',
    subtitle:
      'POST /tracking/gridded — validate house-to-house settlement coverage from GPS tracks against the planned settlement list.',
  },
  'mlos-qc': {
    title: 'MLoS · QC & Validation',
    subtitle: 'POST /qc/validation — comprehensive spatial and attribute QC on a master list of settlements.',
  },
  'mlos-ops': {
    title: 'MLoS · Standardize / Fixer / Update',
    subtitle:
      'POST /qc/standardize · PATCH /qc/fixer · PATCH /mlos/validation — clean up, fix, or merge validated data into a master list, with a before/after comparison of what changed.',
  },
  'uuid-checker': {
    title: 'UUID Checker',
    subtitle: 'GET /uuid_check + POST /uuid_batch_checker — check settlement UUIDs (eha_guid) against the settlements table.',
  },
  reach: {
    title: 'REACH Analysis',
    subtitle: 'POST /validation — triangulate settlement visitation across multiple campaign data sources and methods.',
  },
  'contact-analysis': {
    title: 'Contact Analysis',
    subtitle:
      'POST /contact_analysis — compare a baseline settlement list against previous campaign rounds to measure contact and coverage over time.',
  },
  'target-area': {
    title: 'Target Area Generator',
    subtitle: 'POST /ta/generate_ta — generate voronoi and gridded target-area extents from a master list of settlements.',
  },
  'microplan-combine': {
    title: 'Microplan · Combine DMP Files',
    subtitle:
      'POST /aggregator/dmp/combine — merge digitized microplan ward files into one settlement list and one special-places list, with a coverage summary of what was assembled.',
  },
  'microplan-validate': {
    title: 'Microplan · Validate DIP',
    subtitle:
      "POST /dip/validator — cross-check a compiled Daily Implementation Plan against its ward's allocated field-team distribution: team-code coverage, per-ward staffing shortfalls, and per-team day-of-activity completeness.",
  },
  'microplan-merger': {
    title: 'Microplan · DIP + Map Merger',
    subtitle:
      "POST /dip/merger — interleave each field team's Daily Implementation Plan page with its Team Guide catchment-map page into one page-book PDF per LGA, zipped together as the LGA Map Book.",
  },
  'microplan-generator': {
    title: 'Microplan · DIP Generator',
    subtitle:
      "POST /dip/generator — turn a compiled Daily Implementation Plan into one print-ready PDF per field team (though turning on the Team Allocation cross-check today crashes every batch instead of validating it — see the caveat on the page).",
  },
  'compiler-tracks': {
    title: 'Compiler · Tracks',
    subtitle:
      'POST /compiler/tracks — combine individual GPS track files into one geospatial dataset, optionally clipped to a state boundary, and view every compiled point on a map.',
  },
  'compiler-disaggregate': {
    title: 'Compiler · Disaggregate MLoS',
    subtitle:
      'POST /compiler/disaggregate — split a Master List of Settlements into one Excel sheet per LGA or per Ward, each formatted with borders and data-validation rules.',
  },
  'compiler-lga-data': {
    title: 'Compiler · Combine LGA Data',
    subtitle:
      "POST /compiler/lga_data — merge per-LGA validation datasets into one combined dataset (though as written the route can't complete against realistic input — see the caveat on the page).",
  },
  'daily-report': {
    title: 'Reporting · Daily Report',
    subtitle:
      'POST /reports/daily — bar-chart summary and LGA breakdown of visitation status for a single campaign day, and/or its cumulative status to date (though as written the route is blocked by three separate bugs before any of that can run — see the caveat on the page).',
  },
  'post-implementation': {
    title: 'Reporting · Post Implementation Report',
    subtitle:
      'POST /reports/post — per-LGA summary pie charts and ward-level breakdown bar charts across a campaign settlement list, rendered live from the Plotly figures the backend returns.',
  },
}

// Every view below is always mounted — App.tsx used to conditionally render
// only the active page ({view === 'x' && <XPage/>}), which unmounted every
// other page's component on navigation and threw away its state (an
// in-progress upload, a fetched result, a chosen filter). Switching to
// "mount everything, toggle visibility with CSS" (view/view--active in
// App.css) fixes that: navigate away mid-operation and back, and the page
// is exactly as it was. This is the same approach the approved
// design/mockup.html already uses for its own view switching (.view /
// .view.active), just expressed as React state instead of DOM class
// toggling from onclick handlers.
function viewClass(view: AppView, current: AppView) {
  return `view${view === current ? ' view--active' : ''}`
}

export default function App() {
  const [view, setView] = useState<AppView>('dashboard')
  const meta = VIEW_META[view]

  return (
    <AppShell title={meta.title} subtitle={meta.subtitle} activeView={view} onNavigate={setView}>
      <div className={viewClass('dashboard', view)}>
        <DashboardPage onNavigate={setView} />
      </div>
      <div className={viewClass('h2h', view)}>
        <H2HTrackingPage />
      </div>
      <div className={viewClass('mlos-qc', view)}>
        <MlosQcPage />
      </div>
      <div className={viewClass('mlos-ops', view)}>
        <MlosOpsPage />
      </div>
      <div className={viewClass('uuid-checker', view)}>
        <UuidCheckerPage />
      </div>
      <div className={viewClass('reach', view)}>
        <ReachAnalysisPage />
      </div>
      <div className={viewClass('contact-analysis', view)}>
        <ContactAnalysisPage />
      </div>
      <div className={viewClass('target-area', view)}>
        <TargetAreaPage />
      </div>
      <div className={viewClass('microplan-combine', view)}>
        <MicroplanCombinePage />
      </div>
      <div className={viewClass('microplan-validate', view)}>
        <ValidateDipPage />
      </div>
      <div className={viewClass('microplan-merger', view)}>
        <DipMergerPage />
      </div>
      <div className={viewClass('microplan-generator', view)}>
        <DipGeneratorPage onNavigate={setView} />
      </div>
      <div className={viewClass('compiler-tracks', view)}>
        <TracksPage />
      </div>
      <div className={viewClass('compiler-disaggregate', view)}>
        <DisaggregatePage />
      </div>
      <div className={viewClass('compiler-lga-data', view)}>
        <LgaDataPage />
      </div>
      <div className={viewClass('daily-report', view)}>
        <DailyReportPage />
      </div>
      <div className={viewClass('post-implementation', view)}>
        <PostImplementationPage />
      </div>
    </AppShell>
  )
}
