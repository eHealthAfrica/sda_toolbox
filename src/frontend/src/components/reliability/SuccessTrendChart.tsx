import { useState } from 'react'
import type { DailyStats } from '../../types/reliability'
import { formatPct, longDate, rateScale, shortDate, totalJobs } from '../../utils/reliability'

interface SuccessTrendChartProps {
  daily: DailyStats[]
  target: number
}

// Drawing area, in viewBox units. The success-rate line sits on top; the
// daily job count sits underneath as bars, so a day with a single job and a
// 0% rate reads as what it is rather than as a crash.
const W = 720
const H = 270
const LEFT = 44
const RIGHT = 12
const RATE_TOP = 12
const RATE_BOTTOM = 170
const VOL_TOP = 190
const VOL_BOTTOM = 238

const LINE_COLOR = '#2a78d6'
const BAD_COLOR = '#d03b3b'
const GRID_COLOR = 'rgba(11, 11, 11, 0.08)'

export default function SuccessTrendChart({ daily, target }: SuccessTrendChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  if (daily.length === 0) return null

  const scale = rateScale(daily, target)
  const plotW = W - LEFT - RIGHT
  const n = daily.length
  const xAt = (i: number) => (n === 1 ? LEFT + plotW / 2 : LEFT + (i / (n - 1)) * plotW)
  const yAt = (rate: number) => RATE_BOTTOM - ((rate - scale.lo) / (scale.hi - scale.lo)) * (RATE_BOTTOM - RATE_TOP)
  const slot = plotW / n
  const barW = Math.max(2, Math.min(18, slot * 0.64))
  const maxJobs = Math.max(1, ...daily.map(totalJobs))
  const volY = (jobs: number) => VOL_BOTTOM - (jobs / maxJobs) * (VOL_BOTTOM - VOL_TOP)

  // Join consecutive days that have a rate into one line; a day without jobs
  // breaks the line instead of being drawn as 0 or interpolated across.
  const segments: string[] = []
  let current: string[] = []
  daily.forEach((d, i) => {
    if (d.success_rate === null) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
    } else {
      current.push(`${current.length === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(d.success_rate).toFixed(1)}`)
    }
  })
  if (current.length > 0) segments.push(current.join(' '))

  const labelEvery = Math.max(1, Math.ceil(n / 8))
  const targetY = yAt(target)
  const hoverDay = hover !== null ? daily[hover] : null

  return (
    <div>
      <div
        aria-live="polite"
        style={{ minHeight: 18, fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}
      >
        {hoverDay ? (
          <>
            <strong style={{ color: 'var(--color-text)' }}>{longDate(hoverDay.date)}</strong>
            {' · '}
            {hoverDay.success_rate === null ? 'no counted jobs' : `${formatPct(hoverDay.success_rate)} success`}
            {' · '}
            {hoverDay.completed} completed, {hoverDay.failed_counted} failed (counted), {hoverDay.failed_excluded} failed (not counted)
          </>
        ) : (
          'Hover a day for its numbers.'
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Daily success rate against the ${formatPct(target, 0)} target, with daily job counts below`}
        style={{ display: 'block', maxHeight: 320 }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Rate gridlines and axis labels */}
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W - RIGHT} y1={yAt(t)} y2={yAt(t)} stroke={GRID_COLOR} />
            <text x={LEFT - 6} y={yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-text-muted)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Target line */}
        <line x1={LEFT} x2={W - RIGHT} y1={targetY} y2={targetY} stroke="var(--color-text)" strokeWidth="1.2" strokeDasharray="5 4" opacity="0.7" />
        <text x={W - RIGHT} y={targetY - 5} textAnchor="end" fontSize="10.5" fill="var(--color-text-secondary)">
          target {formatPct(target, 0)}
        </text>

        {/* Success-rate line and points */}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={LINE_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {daily.map((d, i) =>
          d.success_rate === null ? null : (
            <circle
              key={d.date}
              cx={xAt(i)}
              cy={yAt(d.success_rate)}
              r={hover === i ? 5 : 3}
              fill={d.success_rate < target ? BAD_COLOR : LINE_COLOR}
              stroke="var(--color-surface)"
              strokeWidth="1.5"
            />
          ),
        )}

        {/* Daily job volume */}
        <text x={LEFT - 6} y={VOL_TOP + 8} textAnchor="end" fontSize="10.5" fill="var(--color-text-muted)">
          {maxJobs}
        </text>
        <text x={LEFT - 6} y={VOL_BOTTOM} textAnchor="end" fontSize="10.5" fill="var(--color-text-muted)">
          0
        </text>
        <line x1={LEFT} x2={W - RIGHT} y1={VOL_BOTTOM} y2={VOL_BOTTOM} stroke={GRID_COLOR} />
        {daily.map((d, i) => {
          const total = totalJobs(d)
          const x = xAt(i) - barW / 2
          const bad = d.failed_counted
          const badH = (bad / maxJobs) * (VOL_BOTTOM - VOL_TOP)
          const allH = (total / maxJobs) * (VOL_BOTTOM - VOL_TOP)
          return (
            <g key={d.date}>
              {total > 0 && <rect x={x} y={volY(total)} width={barW} height={allH} rx={1.5} fill="#C9DCF2" />}
              {bad > 0 && <rect x={x} y={VOL_BOTTOM - badH} width={barW} height={badH} rx={1.5} fill={BAD_COLOR} opacity="0.85" />}
            </g>
          )
        })}
        <text x={LEFT} y={VOL_TOP - 6} fontSize="10.5" fill="var(--color-text-muted)">
          Jobs per day (red = counted failures)
        </text>

        {/* X labels */}
        {daily.map((d, i) =>
          // Every Nth day, plus the last one; a regular label that would sit
          // right next to the last one is dropped so the two never overlap.
          i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= Math.ceil(labelEvery / 2)) ? (
            <text key={d.date} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--color-text-muted)">
              {shortDate(d.date)}
            </text>
          ) : null,
        )}

        {/* Hover hit areas, one per day, full height */}
        {daily.map((d, i) => (
          <rect
            key={d.date}
            x={xAt(i) - slot / 2}
            y={RATE_TOP - 8}
            width={slot}
            height={VOL_BOTTOM - RATE_TOP + 8}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
          />
        ))}
      </svg>

      {scale.lo > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
          The rate axis starts at {Math.round(scale.lo * 100)}%, not 0%, so small changes stay visible.
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>View as table</summary>
        <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Day', 'Success', 'Completed', 'Failed (counted)', 'Failed (not counted)'].map((h) => (
                  <th
                    key={h}
                    style={{ textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{longDate(d.date)}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{formatPct(d.success_rate)}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.completed}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.failed_counted}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.failed_excluded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
