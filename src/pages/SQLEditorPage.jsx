import { useState, useRef } from 'react'
import { useAuthStore, useUIStore } from '../store/index.js'
import { supabase } from '../api/client.js'

const SAVED_QUERIES = [
  {
    label: 'All Assets — Full Details',
    category: 'Assets',
    description: 'Every asset with type, GPS, feeder, status, remarks',
    sql: `SELECT
  a.asset_code,
  a.asset_type,
  a.name,
  a.latitude,
  a.longitude,
  a.survey_accuracy_m,
  a.status,
  a.flag_note,
  a.remarks,
  a.outstanding_amount,
  a.last_payment_date,
  a.mobile,
  a.survey_date,
  f.code AS feeder_code,
  f.name AS feeder_name,
  p.name AS surveyed_by,
  p.employee_id,
  a.details->>'pole_type' AS pole_type,
  a.details->>'height_m' AS height_m,
  a.details->>'capacity_kva' AS dtr_capacity_kva,
  a.details->>'present_load_pct' AS dtr_load_pct,
  a.details->>'k_number' AS meter_k_number,
  a.details->>'consumer_name' AS consumer_name,
  a.details->>'category' AS meter_category,
  a.details->>'line_type' AS line_type,
  a.details->>'conductor' AS conductor,
  a.details->>'dp_type' AS dp_type,
  a.details->>'iso_type' AS iso_type,
  a.created_at
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
LEFT JOIN profiles p ON a.surveyed_by_id = p.id
ORDER BY a.asset_type, a.asset_code`,
  },
  {
    label: 'All Meters with Outstanding',
    category: 'Revenue',
    description: 'Consumer meters with dues > 0, sorted by amount',
    sql: `SELECT
  a.name AS k_number,
  a.details->>'consumer_name' AS consumer_name,
  a.details->>'category' AS category,
  a.outstanding_amount,
  a.last_payment_date,
  a.mobile,
  a.latitude,
  a.longitude,
  a.status,
  f.code AS feeder_code,
  f.name AS feeder_name,
  a.remarks
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
WHERE a.asset_type = 'meter'
  AND a.outstanding_amount > 0
ORDER BY a.outstanding_amount DESC`,
  },
  {
    label: 'All DTRs with Load',
    category: 'Assets',
    description: 'Distribution transformers with capacity and load',
    sql: `SELECT
  a.asset_code,
  a.name,
  a.details->>'capacity_kva' AS capacity_kva,
  a.details->>'voltage_ratio' AS voltage_ratio,
  a.details->>'make' AS make,
  a.details->>'present_load_pct' AS load_pct,
  a.details->>'consumers_count' AS consumers,
  a.status,
  a.latitude,
  a.longitude,
  f.code AS feeder_code,
  f.name AS feeder_name,
  a.remarks
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
WHERE a.asset_type = 'dtr'
ORDER BY f.code, a.asset_code`,
  },
  {
    label: 'All Poles',
    category: 'Assets',
    description: 'All poles with type, height, line type',
    sql: `SELECT
  a.asset_code,
  a.name,
  a.details->>'pole_type' AS pole_type,
  a.details->>'height_m' AS height_m,
  a.details->>'line_type' AS line_type,
  a.status,
  a.flag_note,
  a.latitude,
  a.longitude,
  a.survey_accuracy_m,
  f.code AS feeder_code,
  a.remarks
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
WHERE a.asset_type = 'pole'
ORDER BY f.code, a.asset_code`,
  },
  {
    label: 'Flagged Assets',
    category: 'Maintenance',
    description: 'All assets with flag or fault status',
    sql: `SELECT
  a.asset_code,
  a.asset_type,
  a.name,
  a.status,
  a.flag_note,
  a.latitude,
  a.longitude,
  f.code AS feeder_code,
  f.name AS feeder_name,
  p.name AS surveyed_by,
  a.remarks,
  a.updated_at
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
LEFT JOIN profiles p ON a.surveyed_by_id = p.id
WHERE a.status IN ('flag','fault')
ORDER BY a.updated_at DESC`,
  },
  {
    label: 'Feeder Asset Summary',
    category: 'Summary',
    description: 'Count of assets per feeder by type',
    sql: `SELECT
  f.code AS feeder_code,
  f.name AS feeder_name,
  COUNT(*) AS total_assets,
  COUNT(*) FILTER (WHERE a.asset_type='pole') AS poles,
  COUNT(*) FILTER (WHERE a.asset_type='dtr') AS dtrs,
  COUNT(*) FILTER (WHERE a.asset_type='meter') AS meters,
  COUNT(*) FILTER (WHERE a.asset_type='line') AS line_spans,
  COUNT(*) FILTER (WHERE a.asset_type='pillar') AS pillars,
  COUNT(*) FILTER (WHERE a.asset_type='iso') AS isolators,
  COUNT(*) FILTER (WHERE a.asset_type='substation') AS substations,
  COUNT(*) FILTER (WHERE a.asset_type='linedp') AS line_dps,
  COUNT(*) FILTER (WHERE a.status != 'ok') AS flagged,
  SUM(CASE WHEN a.asset_type='meter' THEN a.outstanding_amount ELSE 0 END) AS total_outstanding
FROM feeders f
LEFT JOIN assets a ON a.feeder_id = f.id
GROUP BY f.id, f.code, f.name
ORDER BY f.code`,
  },
  {
    label: 'Substations Detail',
    category: 'Assets',
    description: 'All substations with capacity, VCBs, PCBs',
    sql: `SELECT
  s.code,
  s.name AS substation_name,
  s.voltage_ratio,
  s.capacity_mva,
  s.present_load_mva,
  ROUND((s.present_load_mva / NULLIF(s.capacity_mva, 0) * 100)::numeric, 1) AS load_pct,
  s.num_feeders,
  s.num_consumers,
  s.switchgear_type,
  s.num_vcb,
  s.num_pcb,
  s.village,
  s.tehsil,
  s.jen_office,
  s.district,
  s.latitude,
  s.longitude,
  s.survey_accuracy_m,
  s.remarks,
  sd.code AS subdivision_code,
  sd.name AS subdivision_name
FROM substations s
LEFT JOIN subdivisions sd ON s.subdivision_id = sd.id
ORDER BY s.code`,
  },
  {
    label: 'Patrol Reports Summary',
    category: 'Maintenance',
    description: 'All patrol reports with issue counts',
    sql: `SELECT
  pr.report_number,
  f.code AS feeder_code,
  f.name AS feeder_name,
  p.name AS patrolled_by,
  p.employee_id,
  pr.status,
  pr.total_assets,
  pr.total_issues,
  pr.start_time,
  pr.end_time,
  ROUND(EXTRACT(EPOCH FROM (pr.end_time - pr.start_time))/60::numeric, 1) AS duration_mins,
  pr.remarks
FROM patrol_reports pr
LEFT JOIN feeders f ON pr.feeder_id = f.id
LEFT JOIN profiles p ON pr.patrolled_by_id = p.id
ORDER BY pr.created_at DESC`,
  },
  {
    label: 'Patrol Observations Detail',
    category: 'Maintenance',
    description: 'All patrol observations with severity and GPS',
    sql: `SELECT
  pr.report_number,
  po.seq_number,
  po.asset_code,
  po.asset_type,
  po.asset_name,
  po.issue_type,
  po.severity,
  po.description,
  po.patrol_lat,
  po.patrol_lng,
  po.patrol_accuracy,
  po.observed_at,
  f.code AS feeder_code,
  p.name AS patrolled_by
FROM patrol_observations po
LEFT JOIN patrol_reports pr ON po.patrol_id = pr.id
LEFT JOIN feeders f ON pr.feeder_id = f.id
LEFT JOIN profiles p ON pr.patrolled_by_id = p.id
ORDER BY pr.report_number, po.seq_number`,
  },
  {
    label: 'User Activity — Last Login',
    category: 'Users',
    description: 'All users with role and last login',
    sql: `SELECT
  employee_id,
  name,
  role,
  mobile,
  is_active,
  created_at,
  updated_at
FROM profiles
ORDER BY role, name`,
  },
  {
    label: 'Outstanding > ₹10,000',
    category: 'Revenue',
    description: 'High value defaulters with mobile number',
    sql: `SELECT
  a.name AS k_number,
  a.details->>'consumer_name' AS consumer_name,
  a.details->>'category' AS category,
  a.outstanding_amount,
  a.mobile,
  a.latitude,
  a.longitude,
  f.code AS feeder_code
FROM assets a
LEFT JOIN feeders f ON a.feeder_id = f.id
WHERE a.asset_type='meter' AND a.outstanding_amount >= 10000
ORDER BY a.outstanding_amount DESC`,
  },
  {
    label: 'Audit Log — Critical Events',
    category: 'Audit',
    description: 'Critical and warning audit events',
    sql: `SELECT
  al.action,
  al.category,
  al.severity,
  al.description,
  p.name AS performed_by,
  p.employee_id,
  al.meta,
  al.created_at
FROM audit_log al
LEFT JOIN profiles p ON al.user_id = p.id
WHERE al.severity IN ('critical','warn')
ORDER BY al.created_at DESC
LIMIT 200`,
  },
  {
    label: 'Feeders with Substation',
    category: 'Assets',
    description: 'All feeders showing linked substation details',
    sql: `SELECT
  f.code AS feeder_code,
  f.name AS feeder_name,
  f.voltage_kv,
  f.sanctioned_load_kva,
  f.ht_length_km,
  f.lt_length_km,
  s.name AS substation_name,
  s.code AS substation_code,
  s.voltage_ratio,
  s.capacity_mva,
  sd.code AS subdivision_code,
  sd.name AS subdivision_name,
  f.remarks
FROM feeders f
LEFT JOIN substations s ON f.substation_id = s.id
LEFT JOIN subdivisions sd ON f.subdivision_id = sd.id
ORDER BY f.code`,
  },
  {
    label: 'Shutdown History',
    category: 'Operations',
    description: 'All shutdowns with duration and affected feeders',
    sql: `SELECT
  s.substation_name,
  s.shutdown_type,
  s.status,
  s.reason,
  s.start_time,
  s.estimated_restore,
  s.actual_restore,
  ROUND(EXTRACT(EPOCH FROM (COALESCE(s.actual_restore, NOW()) - s.start_time))/3600::numeric, 2) AS duration_hours,
  s.restore_note,
  array_length(s.affected_feeders, 1) AS num_affected_feeders,
  sub.name AS substation_name_full,
  sub.voltage_ratio,
  p.name AS posted_by,
  p.employee_id
FROM shutdowns s
LEFT JOIN substations sub ON s.substation_id = sub.id
LEFT JOIN profiles p ON s.posted_by_id = p.id
ORDER BY s.created_at DESC`,
  },
]

const CATEGORIES = [...new Set(SAVED_QUERIES.map(q => q.category))]

export default function SQLEditorPage() {
  const { isAdmin } = useAuthStore()
  const { toast } = useUIStore()

  const [sql, setSql] = useState('')
  const [results, setResults] = useState(null)
  const [columns, setColumns] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [activeCategory, setActiveCategory] = useState('All')
  const [rowCount, setRowCount] = useState(0)
  const textareaRef = useRef(null)

  const filteredQueries = activeCategory === 'All'
    ? SAVED_QUERIES
    : SAVED_QUERIES.filter(q => q.category === activeCategory)

  function loadQuery(q) {
    setSql(q.sql)
    setResults(null)
    setError(null)
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  async function runQuery() {
    if (!sql.trim()) return toast('Enter a SQL query', 'err')
    // Safety: only allow SELECT
    const trimmed = sql.trim().toUpperCase()
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      return toast('Only SELECT queries are allowed', 'err')
    }
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      // Use Supabase rpc to execute raw SQL safely (read-only)
      // We use postgrest's built-in query capabilities via from().select()
      // For raw SQL we use a workaround via rpc
      const { data, error: qErr } = await supabase.rpc('exec_readonly_sql', { query: sql })
      if (qErr) throw new Error(qErr.message)
      const rows = Array.isArray(data) ? data : (data?.rows || [])
      if (rows.length === 0) {
        setResults([])
        setColumns([])
        setRowCount(0)
        toast('Query returned 0 rows', 'inf')
        return
      }
      setColumns(Object.keys(rows[0]))
      setResults(rows)
      setRowCount(rows.length)
      toast(`✅ ${rows.length} row${rows.length!==1?'s':''} returned`, 'ok')
    } catch(e) {
      setError(e.message)
      toast('Query error', 'err')
    } finally { setRunning(false) }
  }

  function exportCSV() {
    if (!results?.length) return
    const headers = columns.join(',')
    const rows = results.map(r =>
      columns.map(c => {
        const v = r[c]
        if (v === null || v === undefined) return ''
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"'
          : s
      }).join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `geoasset_query_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(`📥 Exported ${results.length} rows`, 'ok')
  }

  function exportJSON() {
    if (!results?.length) return
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `geoasset_query_${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast(`📥 Exported JSON`, 'ok')
  }

  if (!isAdmin()) return (
    <div className="h-full flex items-center justify-center text-mu">
      <div className="text-center"><div className="text-4xl mb-3">🔐</div><div>Admin access only</div></div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

        {/* Left panel — saved queries */}
        <div className="w-full lg:w-64 lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-bd flex flex-col">
          <div className="p-3 border-b border-bd flex-shrink-0">
            <div className="font-rajdhani font-bold text-xs text-a tracking-wider mb-2">📋 SAVED QUERIES</div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setActiveCategory('All')}
                className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-colors
                  ${activeCategory==='All' ? 'bg-a text-bg border-a' : 'border-bd text-mu'}`}>
                All
              </button>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setActiveCategory(c)}
                  className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-colors
                    ${activeCategory===c ? 'bg-a text-bg border-a' : 'border-bd text-mu'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredQueries.map((q, i) => (
              <button key={i} onClick={() => loadQuery(q)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors hover:border-a/50 hover:bg-sf2
                  ${sql === q.sql ? 'border-a bg-a/10' : 'border-bd bg-sf'}`}>
                <div className="text-xs font-semibold text-tx leading-tight">{q.label}</div>
                <div className="text-[9px] text-mu mt-0.5">{q.description}</div>
                <div className="text-[8px] font-bold mt-1 px-1.5 py-0.5 rounded inline-block"
                  style={{ background:'rgba(0,212,255,0.1)', color:'#00d4ff' }}>
                  {q.category}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel — editor + results */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* SQL Editor */}
          <div className="p-3 border-b border-bd flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="font-rajdhani font-bold text-xs text-a tracking-wider">🔍 SQL EDITOR</div>
              <div className="text-[9px] text-mu">SELECT queries only · Read-only</div>
            </div>
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery() } }}
              className="w-full bg-bg border border-bd rounded-xl px-3 py-3 text-xs font-mono text-tx focus:outline-none focus:border-a resize-none leading-relaxed"
              rows={8}
              placeholder="SELECT * FROM assets LIMIT 10;&#10;&#10;Ctrl+Enter to run" />
            <div className="flex gap-2 mt-2">
              <button onClick={runQuery} disabled={running}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-sm disabled:opacity-50">
                {running ? '⏳ Running…' : '▶ Run Query (Ctrl+Enter)'}
              </button>
              <button onClick={() => { setSql(''); setResults(null); setError(null) }}
                className="px-4 py-2.5 rounded-xl border border-bd text-mu text-xs font-bold">
                Clear
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {error && (
              <div className="mx-3 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 font-mono">
                ❌ {error}
              </div>
            )}

            {results && (
              <>
                {/* Results header */}
                <div className="px-3 py-2 border-b border-bd flex items-center justify-between flex-shrink-0">
                  <div className="text-[10px] text-mu">
                    <span className="font-mono font-bold text-a">{rowCount}</span> row{rowCount!==1?'s':''} · {columns.length} column{columns.length!==1?'s':''}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={exportCSV} disabled={!results.length}
                      className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-bold disabled:opacity-40">
                      📥 CSV
                    </button>
                    <button onClick={exportJSON} disabled={!results.length}
                      className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-bold disabled:opacity-40">
                      📥 JSON
                    </button>
                  </div>
                </div>

                {/* Table */}
                {results.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-mu text-sm">
                    No rows returned
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-sf2 border-b border-bd z-10">
                        <tr>
                          <th className="px-2 py-2 text-left font-mono text-[9px] text-mu border-r border-bd w-8">#</th>
                          {columns.map(col => (
                            <th key={col} className="px-3 py-2 text-left font-bold text-[10px] text-a border-r border-bd/50 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((row, i) => (
                          <tr key={i} className={`border-b border-bd/30 ${i%2===0?'bg-bg':'bg-sf/50'} hover:bg-sf2`}>
                            <td className="px-2 py-1.5 font-mono text-[9px] text-mu border-r border-bd/30 text-right">{i+1}</td>
                            {columns.map(col => {
                              const v = row[col]
                              const display = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
                              const isNum = typeof v === 'number'
                              const isNull = v === null || v === undefined
                              return (
                                <td key={col} className="px-3 py-1.5 border-r border-bd/30 max-w-48 whitespace-nowrap overflow-hidden text-ellipsis"
                                  title={display}>
                                  <span className={`${isNull?'text-mu italic':'text-tx'} ${isNum?'font-mono':''}`}>
                                    {isNull ? 'null' : display.length > 60 ? display.slice(0,57)+'…' : display}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {!results && !error && (
              <div className="flex-1 flex flex-col items-center justify-center text-mu gap-3">
                <div className="text-4xl">🔍</div>
                <div className="text-sm">Select a saved query or write your own</div>
                <div className="text-[10px] text-center max-w-xs leading-relaxed">
                  Pick from {SAVED_QUERIES.length} ready-made queries on the left,<br/>
                  or write custom SQL and press Ctrl+Enter
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
