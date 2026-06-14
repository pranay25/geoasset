import { useEffect, useState } from 'react'
import { useAuthStore, useUIStore } from '../store/index.js'
import { auditApi } from '../api/client.js'

const CATEGORY_CONFIG = {
  survey:    { label: 'Survey',    icon: '📡', color: '#00d4ff' },
  asset:     { label: 'Asset',     icon: '🏗️', color: '#10b981' },
  wo:        { label: 'Work Order',icon: '🔧', color: '#3b82f6' },
  mb:        { label: 'Meas. Book',icon: '📋', color: '#a855f7' },
  user:      { label: 'User',      icon: '👥', color: '#f59e0b' },
  hierarchy: { label: 'Hierarchy', icon: '🏛️', color: '#f97316' },
  auth:      { label: 'Auth',      icon: '🔐', color: '#6b7280' },
  system:    { label: 'System',    icon: '⚙️', color: '#6b7280' },
}

const SEVERITY_CONFIG = {
  info:     { label: 'Info',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  warn:     { label: 'Warning',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  critical: { label: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
}

export default function AuditLogPage() {
  const { isAdmin, profile } = useAuthStore()
  const { toast } = useUIStore()

  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { loadLogs() }, [category])

  async function loadLogs() {
    setLoading(true)
    try {
      const data = await auditApi.list({ category, limit: 200 })
      setLogs(data)
    } catch(e) { toast(e.message, 'err') }
    finally { setLoading(false) }
  }

  function fmtTime(ts) {
    const d = new Date(ts)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago'
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
  }

  if (profile?.role !== 'admin') return (
    <div className="h-full flex items-center justify-center text-mu">
      <div className="text-center"><div className="text-4xl mb-3">🔐</div><div>Admin access only</div></div>
    </div>
  )

  const CHIPS = [
    { id: 'all', label: 'All Events' },
    ...Object.entries(CATEGORY_CONFIG).map(([id, { label, icon }]) => ({ id, label: icon + ' ' + label }))
  ]

  // Stats
  const resurveys = logs.filter(l => l.action === 'RESURVEY').length
  const declined  = logs.filter(l => l.action === 'RESURVEY_DECLINED').length
  const warnings  = logs.filter(l => l.severity === 'warn').length
  const criticals = logs.filter(l => l.severity === 'critical').length

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-rajdhani font-bold text-sm">🔍 Audit Log</div>
          <button onClick={loadLogs}
            className="px-3 py-1.5 rounded-xl border border-bd text-mu text-xs hover:border-a hover:text-a transition-colors">
            ↻ Refresh
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            ['📋', logs.length, 'Total'],
            ['🔄', resurveys, 'Resurveys'],
            ['⚠️', warnings, 'Warnings'],
            ['🚨', criticals, 'Critical'],
          ].map(([ic, n, l]) => (
            <div key={l} className="bg-sf border border-bd rounded-xl p-2 text-center">
              <div className="text-sm">{ic}</div>
              <div className="font-mono font-bold text-sm text-tx">{n}</div>
              <div className="text-[9px] text-mu">{l}</div>
            </div>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {CHIPS.map(c => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors
                ${category===c.id ? 'bg-a text-bg border-a' : 'bg-sf text-mu border-bd'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
        {loading && (
          <div className="text-center py-8 text-mu text-sm animate-pulse">Loading logs…</div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-12 text-mu">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm">No events logged yet</div>
            <div className="text-xs mt-1">Events appear as users survey, create WOs, etc.</div>
          </div>
        )}

        {logs.map(log => {
          const cat = CATEGORY_CONFIG[log.category] || CATEGORY_CONFIG.system
          const sev = SEVERITY_CONFIG[log.severity] || SEVERITY_CONFIG.info
          const isExpanded = expanded === log.id
          const meta = log.meta || {}

          return (
            <div key={log.id}
              className={`mb-2 rounded-xl border overflow-hidden transition-all cursor-pointer
                ${log.severity==='critical' ? 'border-red-500/40' : log.severity==='warn' ? 'border-amber-500/30' : 'border-bd'}
                ${isExpanded ? 'bg-sf2' : 'bg-sf hover:bg-sf2'}`}
              onClick={() => setExpanded(isExpanded ? null : log.id)}>

              {/* Main row */}
              <div className="flex items-start gap-3 p-3">
                {/* Category icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                  style={{ background: cat.color + '22' }}>
                  {cat.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Action badge */}
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                      style={{ background: sev.bg, color: sev.color }}>
                      {log.action}
                    </span>
                    {/* Severity badge (only for non-info) */}
                    {log.severity !== 'info' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: sev.bg, color: sev.color }}>
                        {sev.label.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-tx mt-1 leading-snug">{log.description}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-mu">
                    {log.profiles?.name && <span>👤 {log.profiles.name}</span>}
                    {log.profiles?.employee_id && <span className="font-mono">{log.profiles.employee_id}</span>}
                    <span className="ml-auto">{fmtTime(log.created_at)}</span>
                  </div>
                </div>

                <div className="text-mu text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</div>
              </div>

              {/* Expanded meta */}
              {isExpanded && (
                <div className="border-t border-bd/50 px-3 pb-3 pt-2">
                  <div className="text-[10px] text-mu font-bold tracking-wider mb-2">DETAILS</div>
                  <div className="space-y-1">
                    {meta.asset_code && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">Asset Code</span>
                        <span className="font-mono text-a">{meta.asset_code}</span>
                      </div>
                    )}
                    {meta.asset_type && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">Asset Type</span>
                        <span>{meta.asset_type}</span>
                      </div>
                    )}
                    {meta.lat && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">GPS</span>
                        <span className="font-mono">{Number(meta.lat).toFixed(5)}°N, {Number(meta.lng).toFixed(5)}°E</span>
                      </div>
                    )}
                    {meta.replaced_ids?.length > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">Replaced</span>
                        <span className="text-red-400">{meta.replaced_ids.length} asset(s) deleted</span>
                      </div>
                    )}
                    {meta.nearby_ids?.length > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">Nearby assets</span>
                        <span className="text-green-400">{meta.nearby_ids.length} preserved</span>
                      </div>
                    )}
                    {meta.wo_number && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">WO Number</span>
                        <span className="font-mono">{meta.wo_number}</span>
                      </div>
                    )}
                    {meta.mb_number && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">MB Number</span>
                        <span className="font-mono">{meta.mb_number}</span>
                      </div>
                    )}
                    {meta.employee_id && (
                      <div className="flex justify-between text-xs">
                        <span className="text-mu">Employee ID</span>
                        <span className="font-mono">{meta.employee_id}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs pt-1 border-t border-bd/50">
                      <span className="text-mu">Timestamp</span>
                      <span className="font-mono text-[10px]">
                        {new Date(log.created_at).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
