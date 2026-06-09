import { useEffect, useRef, useState } from 'react'
import { usePersistentSession } from '../hooks/usePersistentState.js'
import { useAssetStore, useFeederStore, useAuthStore, useUIStore } from '../store/index.js'
import { patrolApi, auditApi, nearbyApi } from '../api/client.js'
import { ASSET_TYPES } from '../utils/constants.js'

const ISSUE_TYPES = {
  pole: [
    { id:'tilted_pole',   label:'Tilted Pole',         severity:'high'    },
    { id:'broken_pole',   label:'Broken Pole',          severity:'critical'},
    { id:'leaning_pole',  label:'Leaning Pole',         severity:'medium'  },
    { id:'rusted_pole',   label:'Rusted / Corroded',    severity:'low'     },
    { id:'no_earthing',   label:'Earthing Missing',     severity:'high'    },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  dtr: [
    { id:'dtr_burnt',     label:'DTR Burnt',            severity:'critical'},
    { id:'dtr_failed',    label:'DTR Failed / No Load', severity:'critical'},
    { id:'dtr_overload',  label:'DTR Overloaded',       severity:'high'    },
    { id:'oil_leakage',   label:'Oil Leakage',          severity:'high'    },
    { id:'loose_binding', label:'Loose HT Binding',     severity:'medium'  },
    { id:'bushing_crack', label:'Bushing Cracked',      severity:'high'    },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  line: [
    { id:'line_sag',      label:'Line Sag',             severity:'high'    },
    { id:'conductor_break',label:'Conductor Break',     severity:'critical'},
    { id:'loose_joint',   label:'Loose Joint',          severity:'medium'  },
    { id:'insulation_damage',label:'Insulation Damage', severity:'high'    },
    { id:'tree_touching', label:'Tree Touching Wire',   severity:'high'    },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  iso: [
    { id:'faulty_isolator',label:'Faulty Isolator',     severity:'critical'},
    { id:'broken_disc',   label:'Broken Disc',          severity:'high'    },
    { id:'flashover',     label:'Flashover Marks',      severity:'high'    },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  meter: [
    { id:'meter_bypass',  label:'Meter Bypass',         severity:'critical'},
    { id:'meter_broken',  label:'Meter Cover Broken',   severity:'medium'  },
    { id:'no_display',    label:'No Display',           severity:'medium'  },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  pillar: [
    { id:'door_open',     label:'Door Open / Missing',  severity:'high'    },
    { id:'fuse_blown',    label:'Fuse Blown',           severity:'medium'  },
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
  default: [
    { id:'physical_damage',label:'Physical Damage',     severity:'high'    },
    { id:'maintenance_required',label:'Maintenance Required',severity:'medium'},
    { id:'other',         label:'Other Issue',          severity:'medium'  },
  ],
}

const SEV_CONFIG = {
  low:      { color:'#6b7280', bg:'rgba(107,114,128,0.15)', label:'Low'      },
  medium:   { color:'#f59e0b', bg:'rgba(245,158,11,0.15)',  label:'Medium'   },
  high:     { color:'#f97316', bg:'rgba(249,115,22,0.15)',  label:'High'     },
  critical: { color:'#ef4444', bg:'rgba(239,68,68,0.15)',   label:'Critical' },
}

export default function PatrolPage() {
  const { assets } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile, org } = useAuthStore()
  const { toast } = useUIStore()

  // Patrol state
  // ── Persistent patrol session ─────────────────────────────────
  // Active patrol persists across tab switches until completed/discarded
  const { session: ps, setSession: setPs, clearSession: clearPatrol, hasDraft: hasActivePatrol } = usePersistentSession(
    'geoasset_patrol_session',
    { mode: 'list', activeReport: null, observations: [], selectedFeeder: '' }
  )

  const mode           = ps.mode || 'list'
  const activeReport   = ps.activeReport
  const observations   = ps.observations || []
  const selectedFeeder = ps.selectedFeeder || ''
  const setMode            = (v) => setPs({ mode: v })
  const setActiveReport    = (v) => setPs({ activeReport: v })
  const setObservations    = (fn) => setPs(s => ({ ...s, observations: typeof fn==='function' ? fn(s.observations||[]) : fn }))
  const setSelectedFeeder  = (v) => setPs({ selectedFeeder: v })

  const [reports, setReports] = useState([])

  // GPS state
  const [gps, setGPS] = useState(null)
  const [gpsState, setGpsState] = useState('idle')
  const watchRef = useRef(null)

  // Observation modal
  const [obsModal, setObsModal] = useState(null)  // { nearbyAssets, selectedAsset, issue, severity, desc }
  const [nearbyForObs, setNearbyForObs] = useState([])
  const [selAsset, setSelAsset] = useState('')
  const [selIssue, setSelIssue] = useState('')
  const [selSev, setSelSev] = useState('medium')
  const [obsDesc, setObsDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // Map ref for report view
  const mapRef = useRef(null)
  const lmapRef = useRef(null)
  const [viewingReport, setViewingReport] = useState(null)

  // Filter feeders to FI's own feeders only
  const myFeeders = profile?.role === 'feeder_incharge'
    ? feeders.filter(f => f.subdivision_id === profile?.subdivision_id)
    : feeders

  useEffect(() => {
    loadReports()
    return () => stopWatch()
  }, [])

  async function loadReports() {
    try {
      const data = await patrolApi.listReports()
      // FI sees only their own reports
      const mine = profile?.role === 'feeder_incharge'
        ? data.filter(r => r.patrolled_by_id === profile.id)
        : data
      setReports(mine)
    } catch(e) { toast(e.message, 'err') }
  }

  function stopWatch() {
    if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
  }

  function startGPS() {
    if (!navigator.geolocation) return toast('GPS not available', 'err')
    stopWatch()
    setGpsState('acquiring')
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setGPS({ lat, lng, acc })
        if (acc <= 10) setGpsState('locked')
        else setGpsState('acquiring')
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 }
    )
  }

  async function startPatrol() {
    if (!selectedFeeder) return toast('Select a feeder', 'err')
    setSaving(true)
    try {
      const report = await patrolApi.startPatrol(selectedFeeder, profile?.id)
      setActiveReport(report)
      setObservations([])
      setMode('active')
      startGPS()
      await auditApi.log({
        action: 'PATROL_STARTED', category: 'survey', severity: 'info',
        description: `Patrol started: ${report.report_number} on ${feeders.find(f=>f.id===selectedFeeder)?.code}`,
        meta: { report_number: report.report_number, feeder_id: selectedFeeder },
      })
      toast('🚶 Patrol started: ' + report.report_number, 'ok')
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function captureLocation() {
    if (!gps) return toast('Wait for GPS lock', 'err')
    // Query nearby assets on this feeder within 30m
    try {
      const allNearby = await nearbyApi.query(gps.lat, gps.lng, 30)
      const feederAssets = allNearby.filter(a =>
        assets.find(x => x.id === a.id)?.feeder_id === activeReport.feeder_id
      )
      if (feederAssets.length === 0) {
        return toast('No assets within 30m on this feeder', 'warn')
      }
      setNearbyForObs(feederAssets)
      setSelAsset(feederAssets[0]?.id || '')
      setSelIssue('')
      setSelSev('medium')
      setObsDesc('')
      setObsModal(true)
    } catch(e) { toast(e.message, 'err') }
  }

  const currentAsset = selAsset ? assets.find(a => a.id === selAsset) : null
  const issueOptions = currentAsset
    ? (ISSUE_TYPES[currentAsset.asset_type] || ISSUE_TYPES.default)
    : ISSUE_TYPES.default

  async function saveObservation() {
    if (!selAsset) return toast('Select an asset', 'err')
    if (!selIssue) return toast('Select an issue type', 'err')
    setSaving(true)
    try {
      const asset = assets.find(a => a.id === selAsset)
      const issue = issueOptions.find(i => i.id === selIssue)
      const obs = await patrolApi.addObservation(activeReport.id, {
        asset_id: selAsset,
        asset_code: asset?.asset_code,
        asset_type: asset?.asset_type,
        asset_name: asset?.name,
        issue_type: issue?.label || selIssue,
        severity: selSev,
        description: obsDesc,
        patrol_lat: gps?.lat,
        patrol_lng: gps?.lng,
        patrol_accuracy: gps?.acc,
        is_flagged: true,
        seq_number: observations.length + 1,
      })
      setObservations(prev => [...prev, { ...obs, asset }])
      setObsModal(false)
      toast(`✅ #${observations.length+1} recorded`, 'ok')
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function completePatrol() {
    if (!activeReport) return
    const issues = observations.length
    if (issues === 0 && !confirm('No observations recorded. Complete patrol?')) return
    setSaving(true)
    try {
      const done = await patrolApi.completePatrol(
        activeReport.id, observations.length, issues, ''
      )
      setActiveReport(done)
      setPs({ mode: 'complete', activeReport: done, observations: observations })
      stopWatch()
      await auditApi.log({
        action: 'PATROL_COMPLETED', category: 'survey', severity: 'info',
        description: `Patrol completed: ${activeReport.report_number} — ${issues} issues found`,
        meta: { report_number: activeReport.report_number, total_issues: issues },
      })
      toast(`✅ Patrol complete — ${issues} issues found`, 'ok')
      loadReports()
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function generatePDF(report, obs) {
    const { jsPDF } = await import('jspdf').then(m => ({ jsPDF: m.jsPDF || m.default?.jsPDF || m.default }))
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, M = 14

    // ── Header ──
    doc.setFillColor(7,16,30); doc.rect(0,0,W,36,'F')
    doc.setTextColor(0,212,255); doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text(org?.name + ' — ' + org?.division, W/2, 13, { align:'center' })
    doc.setFontSize(11); doc.setTextColor(255,255,255)
    doc.text('MAINTENANCE PATROL REPORT', W/2, 22, { align:'center' })
    doc.setFontSize(9); doc.setTextColor(180,200,220)
    doc.text(report.report_number + '  |  Feeder: ' + (report.feeders?.code||'—') + ' ' + (report.feeders?.name||''), W/2, 30, { align:'center' })

    // ── Meta table ──
    let y = 44
    const meta = [
      ['Report No.', report.report_number],
      ['Feeder', (report.feeders?.code||'—') + ' — ' + (report.feeders?.name||'')],
      ['Patrolled By', (report.profiles?.name||'—') + ' (' + (report.profiles?.employee_id||'') + ')'],
      ['Date', new Date(report.start_time).toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'})],
      ['Start Time', new Date(report.start_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})],
      ['End Time', report.end_time ? new Date(report.end_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—'],
      ['Total Assets Observed', String(obs.length)],
      ['Issues Found', String(obs.filter(o=>o.issue_type).length)],
      ['Critical Issues', String(obs.filter(o=>o.severity==='critical').length)],
    ]
    doc.setFontSize(8)
    meta.forEach(([k,v], i) => {
      const x = i%2===0 ? M : W/2
      if (i%2===0) y += 6
      doc.setFont('helvetica','bold'); doc.setTextColor(80,80,80)
      doc.text(k+':', x, y)
      doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)
      doc.text(String(v), x+45, y)
    })

    // ── Summary badges ──
    y += 10
    const sevCounts = { critical:0, high:0, medium:0, low:0 }
    obs.forEach(o => { if (sevCounts[o.severity]!==undefined) sevCounts[o.severity]++ })
    const badgeColors = { critical:[220,38,38], high:[249,115,22], medium:[245,158,11], low:[107,114,128] }
    let bx = M
    Object.entries(sevCounts).forEach(([sev, count]) => {
      if (count === 0) return
      doc.setFillColor(...badgeColors[sev])
      doc.roundedRect(bx, y-4, 32, 8, 2, 2, 'F')
      doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.setFontSize(7)
      doc.text(sev.toUpperCase()+': '+count, bx+16, y, {align:'center'})
      bx += 36
    })

    // ── Observations table ──
    y += 12
    doc.setFillColor(7,16,30); doc.rect(M, y-5, W-2*M, 8, 'F')
    doc.setFont('helvetica','bold'); doc.setTextColor(0,212,255); doc.setFontSize(7.5)
    const cols = ['#','Asset Code','Type','Issue Found','Severity','Description','GPS Coordinates']
    const cw = [7, 20, 18, 35, 15, 40, 38]
    let cx = M
    cols.forEach((c,i) => { doc.text(c, cx+1, y); cx+=cw[i] })
    y += 3

    doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)
    obs.forEach((o, idx) => {
      y += 6.5
      if (y > 270) { doc.addPage(); y = 20 }
      // Zebra
      if (idx%2===0) { doc.setFillColor(248,250,252); doc.rect(M, y-4.5, W-2*M, 6.5, 'F') }
      // Severity colour dot
      doc.setFillColor(...(badgeColors[o.severity]||[100,100,100]))
      doc.circle(M+3.5, y-1, 1.5, 'F')
      cx = M
      const row = [
        String(o.seq_number||idx+1),
        o.asset_code||'—',
        ASSET_TYPES[o.asset_type]?.label||o.asset_type||'—',
        o.issue_type||'—',
        (o.severity||'').toUpperCase(),
        (o.description||'').slice(0,50),
        o.patrol_lat ? Number(o.patrol_lat).toFixed(5)+'N, '+Number(o.patrol_lng).toFixed(5)+'E' : '—',
      ]
      doc.setFontSize(7)
      row.forEach((v,i) => {
        doc.setTextColor(i===4 ? (badgeColors[o.severity]||[50,50,50])[0] : 20,
                         i===4 ? (badgeColors[o.severity]||[50,50,50])[1] : 20,
                         i===4 ? (badgeColors[o.severity]||[50,50,50])[2] : 20)
        doc.text(String(v).slice(0,i===5?48:25), cx+1, y)
        cx += cw[i]
      })
    })

    // ── GPS coordinate index ──
    y += 12
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(30,60,90)
    doc.text('GPS COORDINATE INDEX', M, y); y += 6
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(40,40,40)
    obs.filter(o=>o.patrol_lat).forEach((o,i) => {
      if (y > 278) { doc.addPage(); y = 15 }
      doc.text(`${o.seq_number||i+1}. ${o.asset_code||'?'} — ${o.asset_name||'?'}`, M, y)
      doc.setTextColor(0,100,180)
      doc.text(`${Number(o.patrol_lat).toFixed(6)}°N, ${Number(o.patrol_lng).toFixed(6)}°E`, M+70, y)
      doc.setTextColor(40,40,40)
      y += 5
    })

    // ── Footer ──
    const pages = doc.internal.getNumberOfPages()
    for (let i=1; i<=pages; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`GeoAsset Patrol System  ·  ${report.report_number}  ·  ${new Date().toLocaleDateString('en-IN')}  ·  Page ${i}/${pages}`, W/2, 290, {align:'center'})
    }

    doc.save(report.report_number + '_Patrol.pdf')
    toast('📄 PDF downloaded', 'ok')
  }

  // View report with map
  async function viewReport(r) {
    setSaving(true)
    try {
      const full = await patrolApi.getReport(r.id)
      setViewingReport(full)
      setMode('view')
      setTimeout(() => initReportMap(full.observations), 300)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  function initReportMap(obs) {
    if (!mapRef.current) return
    if (lmapRef.current) { lmapRef.current.remove(); lmapRef.current = null }
    import('leaflet').then(L => {
      const pts = obs.filter(o=>o.patrol_lat).map(o=>[parseFloat(o.patrol_lat),parseFloat(o.patrol_lng)])
      const center = pts.length ? [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length]
        : [org?.lat||24.5963, org?.lng||76.169]
      const map = L.map(mapRef.current, { center, zoom:16, zoomControl:true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OSM' }).addTo(map)
      // Draw patrol route
      if (pts.length > 1) L.polyline(pts, { color:'#00d4ff', weight:2, dashArray:'6 4', opacity:0.7 }).addTo(map)
      obs.filter(o=>o.patrol_lat).forEach((o,i) => {
        const sev = SEV_CONFIG[o.severity]||SEV_CONFIG.medium
        const icon = L.divIcon({
          className:'',
          html:`<div style="width:22px;height:22px;background:${sev.color};border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.5)">${o.seq_number||i+1}</div>`,
          iconSize:[22,22], iconAnchor:[11,11]
        })
        L.marker([parseFloat(o.patrol_lat),parseFloat(o.patrol_lng)], { icon })
          .bindPopup(`<b>#${o.seq_number||i+1} ${o.asset_code}</b><br>${o.issue_type}<br><span style="color:${sev.color}">${(o.severity||'').toUpperCase()}</span><br><span style="font-size:10px;font-family:monospace">${Number(o.patrol_lat).toFixed(5)}°N</span>`)
          .addTo(map)
      })
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding:[30,30] })
      lmapRef.current = map
    })
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  // ── LIST MODE ───────────────────────────────────────────────
  if (mode === 'list') return (
    <div className="h-full flex flex-col">
      {hasActivePatrol && (mode === 'list') && activeReport && (
        <div className="mx-3 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-amber-400 font-bold text-sm">🚶 Patrol In Progress</div>
            <div className="text-[10px] text-mu">{activeReport.report_number} · {observations.length} observations</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPs({ mode: 'active' })}
              className="px-3 py-1.5 rounded-xl bg-a/10 border border-a/30 text-a text-[10px] font-bold">
              Resume →
            </button>
            <button onClick={() => { if(confirm('Discard patrol?')) clearPatrol() }}
              className="px-2 py-1.5 rounded-xl border border-red-500/30 text-red-400 text-[10px]">
              🗑
            </button>
          </div>
        </div>
      )}
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd flex items-center justify-between">
        <div>
          <div className="font-rajdhani font-bold text-sm">🚶 Maintenance Patrol</div>
          <div className="text-[10px] text-mu mt-0.5">Feeder-based field inspection</div>
        </div>
        <button onClick={() => setMode('select')}
          className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
          + Start Patrol
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {reports.length === 0 && (
          <div className="text-center py-16 text-mu">
            <div className="text-5xl mb-3">🚶</div>
            <div className="text-sm">No patrol reports yet</div>
          </div>
        )}
        {reports.map(r => {
          const feeder = feeders.find(f=>f.id===r.feeder_id)
          return (
            <div key={r.id} className="bg-sf border border-bd rounded-2xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-mono text-xs text-a">{r.report_number}</div>
                  <div className="font-bold text-sm mt-0.5">⚡ {feeder?.code} — {feeder?.name}</div>
                  <div className="text-[10px] text-mu mt-0.5">
                    {new Date(r.start_time).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                    {' · '}{r.profiles?.name}
                  </div>
                </div>
                <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${r.status==='completed'?'bg-green-500/15 text-green-400':'bg-amber-500/15 text-amber-400'}`}>
                  {r.status.toUpperCase()}
                </span>
              </div>
              <div className="flex gap-2 text-[10px] text-mu mb-3">
                <span>🔍 {r.total_assets} observed</span>
                <span>⚠️ {r.total_issues} issues</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => viewReport(r)}
                  className="flex-1 py-2 rounded-xl border border-bd text-mu text-xs font-bold">
                  🗺️ View Report
                </button>
                <button onClick={() => patrolApi.getReport(r.id).then(full => generatePDF(full, full.observations))}
                  className="flex-1 py-2 rounded-xl border border-a/30 bg-a/10 text-a text-xs font-bold">
                  📄 Download PDF
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ── SELECT FEEDER MODE ──────────────────────────────────────
  if (mode === 'select') return (
    <div className="h-full flex flex-col p-5">
      <div className="text-center pt-6 mb-8">
        <div className="text-5xl mb-3">🚶</div>
        <div className="font-rajdhani font-bold text-2xl text-a">Start Patrol</div>
        <div className="text-mu text-sm mt-1">Select feeder to patrol</div>
      </div>
      <div className="space-y-3 flex-1">
        {myFeeders.map(f => (
          <button key={f.id} onClick={() => setSelectedFeeder(f.id)}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all
              ${selectedFeeder===f.id ? 'border-a bg-a/10' : 'border-bd bg-sf'}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${selectedFeeder===f.id?'bg-a/20':'bg-bg'}`}>
              ⚡
            </div>
            <div>
              <div className={`font-mono font-bold text-base ${selectedFeeder===f.id?'text-a':'text-tx'}`}>{f.code}</div>
              <div className="text-sm text-mu">{f.name}</div>
              <div className="text-[10px] text-mu mt-0.5">
                {assets.filter(a=>a.feeder_id===f.id).length} assets surveyed
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={() => setMode('list')} className="px-6 py-4 rounded-2xl border border-bd text-mu font-bold">← Back</button>
        <button onClick={startPatrol} disabled={!selectedFeeder||saving}
          className="flex-1 py-4 rounded-2xl font-rajdhani font-bold text-lg disabled:opacity-40"
          style={{ background:'linear-gradient(135deg,#00d4ff,#3b82f6)', color:'#07101e' }}>
          {saving ? '⏳…' : '🚶 Begin Patrol'}
        </button>
      </div>
    </div>
  )

  // ── ACTIVE PATROL MODE ──────────────────────────────────────
  if (mode === 'active') {
    const feeder = feeders.find(f=>f.id===activeReport?.feeder_id)
    const gpsColor = gpsState==='locked'?'#10b981':gpsState==='acquiring'?'#f59e0b':'#4e7090'
    return (
      <div className="h-full flex flex-col">
        {/* Patrol header */}
        <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                <span className="font-rajdhani font-bold text-sm text-red-400">PATROL ACTIVE</span>
              </div>
              <div className="text-xs text-mu">{activeReport?.report_number} · ⚡{feeder?.code}</div>
            </div>
            <div className="text-right">
              <div className="font-mono font-bold text-base text-tx">{observations.length}</div>
              <div className="text-[9px] text-mu">observations</div>
            </div>
          </div>
          {/* GPS status */}
          <div className="flex items-center gap-2 mt-2 text-[10px]" style={{color:gpsColor}}>
            <div className={`w-1.5 h-1.5 rounded-full ${gpsState==='acquiring'?'animate-pulse':''}`} style={{background:gpsColor}} />
            GPS {gpsState.toUpperCase()}
            {gps && <span className="font-mono">±{Math.round(gps.acc)}m · {gps.lat.toFixed(4)}°N {gps.lng.toFixed(4)}°E</span>}
          </div>
        </div>

        {/* Observations list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {observations.length === 0 && (
            <div className="text-center py-12 text-mu text-sm">
              Walk to an asset and tap "Record Observation"
            </div>
          )}
          {observations.map((o, i) => {
            const sev = SEV_CONFIG[o.severity] || SEV_CONFIG.medium
            const cfg = ASSET_TYPES[o.asset_type]
            return (
              <div key={o.id||i} className="flex items-center gap-3 p-3 bg-sf border border-bd rounded-xl">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{background:sev.bg}}>
                  {cfg?.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">{o.asset_code} — {o.asset_name}</div>
                  <div className="text-xs text-mu">{o.issue_type}</div>
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{background:sev.bg,color:sev.color}}>
                  {sev.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Action buttons */}
        <div className="p-4 border-t border-bd flex-shrink-0 space-y-3">
          <button onClick={captureLocation}
            className="w-full py-4 rounded-2xl font-rajdhani font-bold text-lg"
            style={{background:'linear-gradient(135deg,#f59e0b,#f97316)',color:'#07101e'}}>
            📍 Record Observation at Current Location
          </button>
          <button onClick={completePatrol} disabled={saving}
            className="w-full py-3 rounded-2xl border-2 border-green-500/40 bg-green-500/10 text-green-400 font-rajdhani font-bold">
            {saving ? '⏳…' : '✅ Complete Patrol'}
          </button>
        </div>

        {/* Observation Modal */}
        {obsModal && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end">
            <div className="w-full bg-sf border-t-2 border-a/40 rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto">
              <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-3" />
              <div className="font-rajdhani font-bold text-a mb-4">📍 Record Observation</div>
              <div className="space-y-3">
                {/* Asset dropdown */}
                <div>
                  <label className={`text-[10px] text-mu block mb-1.5`}>Asset (found within 30m)</label>
                  <select className={inp} value={selAsset} onChange={e=>{setSelAsset(e.target.value);setSelIssue('')}}>
                    <option value="">Select asset…</option>
                    {nearbyForObs.map(a=>{
                      const full = assets.find(x=>x.id===a.id)
                      const cfg = ASSET_TYPES[full?.asset_type]
                      return <option key={a.id} value={a.id}>{cfg?.icon} {full?.name} ({cfg?.label}) · {a.distance_m}m</option>
                    })}
                  </select>
                </div>
                {/* Issue type */}
                {selAsset && (
                  <div>
                    <label className="text-[10px] text-mu block mb-1.5">Issue Found *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {issueOptions.map(iss => (
                        <button key={iss.id} onClick={()=>{setSelIssue(iss.id);setSelSev(iss.severity)}}
                          className={`py-3 px-2 rounded-xl border-2 text-xs font-bold text-left transition-all
                            ${selIssue===iss.id
                              ? 'border-a bg-a/10 text-a'
                              : 'border-bd text-mu'}`}>
                          <span className="block" style={{color:SEV_CONFIG[iss.severity]?.color}}>
                            ● {SEV_CONFIG[iss.severity]?.label}
                          </span>
                          {iss.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Severity override */}
                {selIssue && (
                  <div>
                    <label className="text-[10px] text-mu block mb-1.5">Severity</label>
                    <div className="grid grid-cols-4 gap-2">
                      {Object.entries(SEV_CONFIG).map(([sev,cfg])=>(
                        <button key={sev} onClick={()=>setSelSev(sev)}
                          className={`py-2 rounded-xl border-2 text-[10px] font-bold transition-all
                            ${selSev===sev ? 'border-current' : 'border-bd text-mu'}`}
                          style={selSev===sev?{borderColor:cfg.color,background:cfg.bg,color:cfg.color}:{}}>
                          {cfg.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Description */}
                <div>
                  <label className="text-[10px] text-mu block mb-1.5">Description / Notes</label>
                  <textarea className={inp} rows={2} value={obsDesc} onChange={e=>setObsDesc(e.target.value)}
                    placeholder="Describe the issue in detail…" />
                </div>
                <div className="flex gap-3">
                  <button onClick={()=>setObsModal(false)} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
                  <button onClick={saveObservation} disabled={saving||!selAsset||!selIssue}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-40">
                    {saving?'⏳…':'✅ Save Observation'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── COMPLETE MODE ───────────────────────────────────────────
  if (mode === 'complete') return (
    <div className="h-full flex flex-col items-center justify-center p-6">
      <div className="text-6xl mb-4">✅</div>
      <div className="font-rajdhani font-bold text-2xl text-green-400 mb-2">Patrol Complete!</div>
      <div className="font-mono text-a mb-1">{activeReport?.report_number}</div>
      <div className="text-mu text-sm mb-8">{observations.length} observations · {observations.filter(o=>o.severity==='critical').length} critical</div>
      <div className="w-full space-y-3">
        <button onClick={() => generatePDF(activeReport, observations)}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-lg">
          📄 Download PDF Report
        </button>
        <button onClick={() => { clearPatrol() }}
          className="w-full py-3 rounded-2xl border border-bd text-mu font-rajdhani font-bold">
          ← Back to Reports
        </button>
      </div>
    </div>
  )

  // ── VIEW REPORT MODE ────────────────────────────────────────
  if (mode === 'view' && viewingReport) return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-0 flex-shrink-0 flex items-center gap-3 border-b border-bd">
        <button onClick={()=>{setMode('list');if(lmapRef.current){lmapRef.current.remove();lmapRef.current=null}}}
          className="text-mu text-sm">← Back</button>
        <div className="flex-1">
          <div className="font-mono text-xs text-a">{viewingReport.report_number}</div>
          <div className="text-xs text-mu">{viewingReport.feeders?.code} · {viewingReport.profiles?.name}</div>
        </div>
        <button onClick={() => generatePDF(viewingReport, viewingReport.observations)}
          className="px-3 py-1.5 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
          📄 PDF
        </button>
      </div>
      {/* Map */}
      <div ref={mapRef} style={{height:'240px'}} className="flex-shrink-0" />
      {/* Observations */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(viewingReport.observations||[]).map((o,i) => {
          const sev = SEV_CONFIG[o.severity]||SEV_CONFIG.medium
          return (
            <div key={o.id||i} className="bg-sf border border-bd rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-a">#{o.seq_number||i+1}</span>
                  <span className="font-bold text-sm">{o.asset_code}</span>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{background:sev.bg,color:sev.color}}>{sev.label}</span>
                </div>
              </div>
              <div className="text-xs text-mu">{o.issue_type}</div>
              {o.description&&<div className="text-xs text-tx mt-1">{o.description}</div>}
              {o.patrol_lat&&<div className="font-mono text-[10px] text-a mt-1">{Number(o.patrol_lat).toFixed(5)}°N, {Number(o.patrol_lng).toFixed(5)}°E</div>}
            </div>
          )
        })}
      </div>
    </div>
  )

  return null
}
