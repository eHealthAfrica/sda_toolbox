import type { JobRow } from '../../types/jobs'
import { formatMs, relativeTime, truncate } from '../../utils/reliability'
import { readableErrorString } from '../../utils/apiErrorText'
import { CategoryPill, EmptyNote, monoStyle, thStyle, tdStyle } from './reliabilityShared'

interface RecentFailuresTableProps {
  jobs: JobRow[]
}

// The newest failed jobs with whatever the backend recorded about each. The
// category, exception type and stage columns come from the reliability
// upgrade; on an older backend they are empty and the plain `error` text
// (for example "HTTP 500") is shown instead.
export default function RecentFailuresTable({ jobs }: RecentFailuresTableProps) {
  if (jobs.length === 0) return <EmptyNote>No failed jobs to show.</EmptyNote>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            <th style={thStyle}>When</th>
            <th style={thStyle}>Tool</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>What happened</th>
            <th style={thStyle}>Stage</th>
            <th style={thStyle}>Took</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            // error_detail holds the start of the response body; show the sentence in it, not the JSON.
            const readable = readableErrorString(job.error_detail)
            const detailText = readable ? readable.summary : job.error_detail
            const what = job.error_type ? `${job.error_type}${detailText ? `: ${detailText}` : ''}` : (detailText ?? job.error ?? '')
            return (
              <tr key={job.id}>
                <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  <span title={new Date(job.started_at).toLocaleString()}>{relativeTime(job.started_at)}</span>
                  {job.source === 'canary' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-muted)' }}>canary</span>}
                </td>
                <td style={tdStyle}>{job.label}</td>
                <td style={tdStyle}>{job.error_category ? <CategoryPill category={job.error_category} /> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td style={{ ...tdStyle, maxWidth: 320 }}>
                  <span style={{ ...monoStyle, overflowWrap: 'anywhere' }} title={readable?.hint ? `${what} ${readable.hint}` : what}>
                    {truncate(what, 120)}
                  </span>
                  {job.status_code !== null && !what.includes(`HTTP ${job.status_code}`) && (
                    <span style={{ marginLeft: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>HTTP {job.status_code}</span>
                  )}
                </td>
                <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{job.stage ?? '—'}</td>
                <td style={tdStyle} className="tabular">
                  {formatMs(job.duration_ms)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
