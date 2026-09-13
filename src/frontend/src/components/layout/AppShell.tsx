import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useJobTracker, countJobEventsSince } from '../../state/jobTracker'
import type { JobRecord } from '../../state/jobTracker'
import '../../App.css'

// Persists purely as a UI-chrome convenience — not app data, so plain
// localStorage (rather than anything server-side) is the right place for
// it; wrapped in try/catch since some locked-down browser profiles throw on
// any localStorage access at all, in which case collapse just resets to
// expanded on the next load instead of erroring the whole shell.
const SIDEBAR_COLLAPSED_KEY = 'toolbox.sidebarCollapsed'

function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

// Sixteen pages exist now (H2H tracking, MLoS QC & Validation, MLoS
// Standardize/Fixer/Update, UUID Checker, REACH analysis, Contact Analysis,
// Target Area generator, Microplan Combine DMP Files, Microplan Validate
// DIP, Microplan DIP + Map Merger, Microplan DIP Generator, Compiler Tracks,
// Compiler Disaggregate MLoS, Compiler Combine LGA Data, Reporting Daily
// Report, Reporting Post Implementation Report) — no router yet, just a view
// key App.tsx switches on. Future per-endpoint pages (hit-and-run, etc.)
// slot in the same way — see the "in depth assessment of each endpoint"
// plan this page kicks off.
export type AppView =
  | 'dashboard'
  | 'h2h'
  | 'mlos-qc'
  | 'mlos-duplicate-checker'
  | 'mlos-coordinate-review'
  | 'mlos-ops'
  | 'uuid-checker'
  | 'reach'
  | 'contact-analysis'
  | 'target-area'
  | 'microplan-combine'
  | 'microplan-validate'
  | 'microplan-merger'
  | 'microplan-generator'
  | 'compiler-tracks'
  | 'compiler-disaggregate'
  | 'compiler-lga-data'
  | 'daily-report'
  | 'post-implementation'

interface NavItemConfig {
  view: AppView
  label: string
  badge?: string
  icon: ReactNode
}

interface NavGroupConfig {
  label: string
  items: NavItemConfig[]
}

// The ungrouped "Dashboard" item at the very top of the sidebar, same as the
// mockup — it sits outside every module group, so it's rendered separately
// below rather than folded into NAV_GROUPS.
const DASHBOARD_ITEM: NavItemConfig = {
  view: 'dashboard',
  label: 'Dashboard',
  icon: (
    <svg viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="1" width="6" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1" y="9" width="6" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="6" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
}

// Icons and grouping are carried over 1:1 from the approved mockup's sidebar
// (sda_toolbox_frontend_design/mockup.html — MLoS / Tracking / Campaign /
// Compiler / Microplan / Reporting / Data Access groups), restricted to the
// AppViews that actually have a real page here. Two icons (DIP + Map Merger,
// DIP Generator) don't exist in this app's group yet in the mockup's
// original Microplan group either — they were added to the mockup after —
// so those two are pulled from the same mockup file's later markup rather
// than invented fresh, keeping the same thin-stroke 16x16 icon language.
const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: 'MLoS',
    items: [
      {
        view: 'mlos-qc',
        label: 'QC & Validation',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1c-2.8 0-5 2.1-5 4.9C3 9.5 8 15 8 15s5-5.5 5-9.1C13 3.1 10.8 1 8 1z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="8" cy="5.7" r="1.6" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        ),
      },
      {
        view: 'mlos-duplicate-checker',
        label: 'Duplicate Checker',
        badge: 'new',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="9" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
            <rect x="5" y="5" width="9" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ),
      },
      {
        view: 'mlos-coordinate-review',
        label: 'Coordinate Review',
        badge: 'new',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 1v2.6M8 12.4V15M1 8h2.6M12.4 8H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        view: 'mlos-ops',
        label: 'Standardize / Fixer / Update',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1c-2.8 0-5 2.1-5 4.9C3 9.5 8 15 8 15s5-5.5 5-9.1C13 3.1 10.8 1 8 1z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Tracking',
    items: [
      {
        view: 'h2h',
        label: 'Gridded H2H Tracking',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="1.8" fill="currentColor" />
            <circle cx="3" cy="4" r="1.3" fill="currentColor" opacity=".55" />
            <circle cx="13" cy="3.5" r="1.3" fill="currentColor" opacity=".55" />
            <circle cx="13" cy="12.5" r="1.3" fill="currentColor" opacity=".55" />
            <circle cx="3.5" cy="12" r="1.3" fill="currentColor" opacity=".55" />
          </svg>
        ),
      },
      {
        view: 'reach',
        label: 'REACH Analysis',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        view: 'contact-analysis',
        label: 'Contact Analysis',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="5.5" cy="5.5" r="2.3" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="11" cy="10.5" r="2.3" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.3 6.9l2.4 2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Campaign',
    items: [
      {
        view: 'target-area',
        label: 'Target Area Generator',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M1 3l5-1.5 4 1.5 5-1.5v11l-5 1.5-4-1.5-5 1.5V3z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Compiler',
    items: [
      {
        view: 'compiler-tracks',
        label: 'Tracks',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M1 3l5-1.5 4 1.5 5-1.5v11l-5 1.5-4-1.5-5 1.5V3z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        view: 'compiler-disaggregate',
        label: 'Disaggregate MLoS',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2.5" y="1.5" width="11" height="13" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.5 5.5h11M2.5 9.5h11" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ),
      },
      {
        view: 'compiler-lga-data',
        label: 'Combine LGA Data',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="8.5" y="2" width="5.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 12.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Microplan',
    items: [
      {
        view: 'microplan-combine',
        label: 'Combine DMP Files',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 6h13M5 1.2v2.6M11 1.2v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        view: 'microplan-validate',
        label: 'Validate DIP',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M2.5 8.5l3.5 3.5 7-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        view: 'microplan-merger',
        label: 'DIP + Map Merger',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="8.5" y="2" width="5.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 12.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        view: 'microplan-generator',
        label: 'DIP Generator',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2.5" y="1.5" width="8" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5 5h3.5M5 7.5h3.5M5 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M11.5 6l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Reporting',
    items: [
      {
        view: 'daily-report',
        label: 'Daily Report',
        badge: 'new',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M2 14V6M7 14V2M12 14V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        view: 'post-implementation',
        label: 'Post Implementation Report',
        badge: 'new',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5A6.5 6.5 0 1114.5 8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.5v3.8l2.6 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 14V9.5M6 14V6.5M10 14V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Data Access',
    items: [
      {
        view: 'uuid-checker',
        label: 'UUID Checker',
        icon: (
          <svg viewBox="0 0 16 16" fill="none">
            <ellipse cx="8" cy="3.2" rx="6" ry="2.1" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M2 3.2v9.6c0 1.16 2.7 2.1 6 2.1s6-.94 6-2.1V3.2M2 8c0 1.16 2.7 2.1 6 2.1s6-.94 6-2.1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        ),
      },
    ],
  },
]

// Reuses the same nav data the sidebar renders from, rather than a second
// hand-maintained view->label map, so the notification panel's tool names
// (below) can never drift out of sync with the sidebar's own labels.
const VIEW_NAV_LABELS: Partial<Record<AppView, string>> = Object.fromEntries(
  [DASHBOARD_ITEM, ...NAV_GROUPS.flatMap((group) => group.items)].map((item) => [item.view, item.label]),
)

const RECENT_ACTIVITY_LIMIT = 8

function formatRelativeTime(timestampMs: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000))
  if (deltaSeconds < 5) return 'just now'
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.round(deltaMinutes / 60)
  return `${deltaHours}h ago`
}

interface AppShellProps {
  title: string
  subtitle?: string
  activeView: AppView
  onNavigate: (view: AppView) => void
  children: ReactNode
}

export default function AppShell({ title, subtitle, activeView, onNavigate, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(getInitialSidebarCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // See getInitialSidebarCollapsed — best-effort only.
    }
  }, [collapsed])

  // Notification bell: badge count + dropdown, driven by state/jobTracker.tsx
  // — the same session-scoped store every page's handleSubmit already
  // reports into via startJob/completeJob/failJob, just never displayed
  // anywhere before now. `lastSeenAt` marks the last time the panel was
  // opened; countJobEventsSince derives "how many start/complete/fail events
  // have happened since then" straight from each job's own timestamps, so
  // the badge updates the instant any page's job transitions — no polling,
  // no separate event log to keep in sync.
  const { jobs } = useJobTracker()
  const [notifOpen, setNotifOpen] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState(0)
  const notifRef = useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(() => countJobEventsSince(jobs, lastSeenAt), [jobs, lastSeenAt])

  const recentJobs = useMemo(() => {
    const withActivityAt = jobs.map((job) => ({ job, activityAt: job.endedAt ?? job.startedAt }))
    withActivityAt.sort((a, b) => b.activityAt - a.activityAt)
    return withActivityAt.slice(0, RECENT_ACTIVITY_LIMIT).map(({ job }) => job)
  }, [jobs])

  function toggleNotifPanel() {
    setNotifOpen((open) => {
      const next = !open
      if (next) setLastSeenAt(Date.now())
      return next
    })
  }

  useEffect(() => {
    if (!notifOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [notifOpen])

  function jobRowLabel(job: JobRecord): string {
    return VIEW_NAV_LABELS[job.view] ?? job.view
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}>
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-mark" />
          {!collapsed && (
            <div>
              <div className="app-sidebar__brand-name">SDA Toolbox</div>
              <div className="app-sidebar__brand-sub">EOC Analyst Workspace</div>
            </div>
          )}
        </div>
        <nav className="app-sidebar__nav">
          <div className="app-sidebar__group">
            <div
              className={`app-sidebar__item${activeView === DASHBOARD_ITEM.view ? ' app-sidebar__item--active' : ''}`}
              onClick={() => onNavigate(DASHBOARD_ITEM.view)}
              title={collapsed ? DASHBOARD_ITEM.label : undefined}
            >
              {DASHBOARD_ITEM.icon}
              {!collapsed && DASHBOARD_ITEM.label}
            </div>
          </div>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="app-sidebar__group">
              {!collapsed && <div className="app-sidebar__group-label">{group.label}</div>}
              {group.items.map((item) => (
                <div
                  key={item.view}
                  className={`app-sidebar__item${activeView === item.view ? ' app-sidebar__item--active' : ''}`}
                  onClick={() => onNavigate(item.view)}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  {!collapsed && item.label}
                  {!collapsed && item.badge && <span className="app-sidebar__badge">{item.badge}</span>}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="app-sidebar__footer">
          {collapsed ? (
            <img src="/eha-mark.png" alt="eHealth Africa" className="app-sidebar__footer-mark" title="Powered by eHealth Africa" />
          ) : (
            <>
              <div className="app-sidebar__footer-label">Powered by</div>
              <img src="/eha-logo.png" alt="eHealth Africa" className="app-sidebar__footer-logo" />
            </>
          )}
        </div>
        <button
          type="button"
          className="app-sidebar__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}>
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>
      <div className="app-main-col">
        {/* The two static sample-data pills that used to sit here ("Kebbi
            State" / "Round 2 · Day 4") were replaced with a single live
            control: a dropdown that jumps straight to any tool, built from
            the same NAV_GROUPS/DASHBOARD_ITEM data the sidebar itself
            renders from, so the two navigation surfaces can never drift out
            of sync. The notification bell is likewise now live rather than
            decorative — see the useJobTracker()-backed state above. The
            avatar is the eHA globe mark rather than a person's initials —
            this is a shared internal tool, not a per-user account view. */}
        <div className="app-topbar">
          <div className="app-topbar__crumb">{title}</div>
          <div className="app-topbar__spacer" />
          <div className="app-topbar__tool-select">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="1.5" width="5" height="5" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="9.5" y="1.5" width="5" height="5" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="1.5" y="9.5" width="5" height="5" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="9.5" y="9.5" width="5" height="5" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <select
              value={activeView}
              onChange={(e) => onNavigate(e.target.value as AppView)}
              aria-label="Jump to tool"
            >
              <option value={DASHBOARD_ITEM.view}>{DASHBOARD_ITEM.label}</option>
              {NAV_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((item) => (
                    <option key={item.view} value={item.view}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="app-notif" ref={notifRef}>
            <button
              type="button"
              className="app-topbar__icon-btn"
              onClick={toggleNotifPanel}
              aria-label="Notifications"
              aria-expanded={notifOpen}
              title="Notifications"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5c-2 0-3.4 1.6-3.4 3.8v2.2c0 .5-.2 1-.5 1.4L3 10.3h10l-1.1-1.4c-.3-.4-.5-.9-.5-1.4V5.3C11.4 3.1 10 1.5 8 1.5z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {unreadCount > 0 && <span className="app-topbar__notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {notifOpen && (
              <div className="app-notif__panel">
                <div className="app-notif__panel-header">Recent activity — this session</div>
                {recentJobs.length === 0 ? (
                  <div className="app-notif__empty">No submissions yet — run any tool and it&apos;ll show up here.</div>
                ) : (
                  recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className="app-notif__row"
                      onClick={() => {
                        onNavigate(job.view)
                        setNotifOpen(false)
                      }}
                    >
                      <span className={`job-status-pill job-status-pill--${job.status}`}>{job.status}</span>
                      <div className="app-notif__row-text">
                        <div className="app-notif__row-label">{jobRowLabel(job)}</div>
                        <div className="app-notif__row-sub">{job.label}</div>
                      </div>
                      <div className="app-notif__row-time">{formatRelativeTime(job.endedAt ?? job.startedAt)}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <img src="/eha-mark.png" alt="eHealth Africa" className="app-topbar__avatar" />
        </div>
        <main className="app-main">
          <header className="app-header">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
        </main>
      </div>
    </div>
  )
}
