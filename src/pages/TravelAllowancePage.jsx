import { useEffect, useRef, useState } from 'react'
import { usePersistentSession } from '../hooks/usePersistentState.js'
import { useAuthStore, useUIStore, useSubstationStore } from '../store/index.js'
import { taApi } from '../api/client.js'

export default function TravelAllowancePage() {
  const { profile, org } = useAuthStore()
  const { toast } = useUIStore()
  const { substations, fetch: fetchSubstations } = useSubstationStore()

  const [view, setView] = useState('list')   // list | new | view
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewingJourney, setViewingJourney] = useState(null)
  const [saving, setSaving] = useState(false)

  // Persistent active journey session — survives tab switches
  const { session: js, setSession: setJs, clearSession: clearJourney, hasDraft: hasActiveJourney } =
    usePersistentSession('geoasset_ta_journey', {
      journey: null, captures: [], substationLat: null, substationLng: null,
    })
  const activeJourney   = js.journey
  const captures        = js.captures || []
  const substationLat   = js.substationLat
  const substationLng   = js.substationLng

  // New journey form
  const [form, setForm] = useState({ substationId: '', purpose: '' })

  // GPS capture state
  const [gpsState, setGpsState] = useState('idle')
  const [gps, setGPS] = useState(null)
  const [bestFix, setBestFix] = useState(null)
  const [captureNote, setCaptureNote] = useState('')
  const watchRef = useRef(null)

  useEffect(() => {
    loadJourneys()
    fetchSubstations()
  }, [])

  async function loadJourneys() {
    setLoading(true)
    try { setJourneys(await taApi.listJourneys(profile?.id)) }
    catch(e) { toast(e.message, 'err') }
    finally { setLoading(false) }
  }

  // ── Time window check (8 AM – 8 PM) ─────────────────────────
  function withinWindow() {
    const h = new Date().getHours()
    return h >= 8 && h < 20
  }

  // ── Start journey ───────────────────────────────────────────
  async function startJourney() {
    if (!form.substationId) return toast('Select your serving substation', 'err')
    if (!form.purpose.trim()) return toast('Enter purpose of travel', 'err')
    if (!withinWindow()) {
      if (!confirm('Current time is outside 8 AM – 8 PM window. Continue anyway?')) return
    }
    const sub = substations.find(s => s.id === form.substationId)
    if (!sub?.latitude) return toast('This substation has no GPS surveyed yet', 'err')
    setSaving(true)
    try {
      const journey = await taApi.startJourney({
        userId: profile?.id,
        substationId: sub.id,
        substationName: sub.name,
        substationLat: parseFloat(sub.latitude),
        substationLng: parseFloat(sub.longitude),
        purpose: form.purpose,
      })
      setJs({ journey, captures: [], substationLat: parseFloat(sub.latitude), substationLng: parseFloat(sub.longitude) })
      setForm({ substationId: '', purpose: '' })
      setView('list')
      toast('🚗 Journey started: ' + journey.journey_number, 'ok')
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  // ── GPS capture ──────────────────────────────────────────────
  function startGPS() {
    if (!navigator.geolocation) return toast('GPS not available', 'err')
    stopWatch()
    setGPS(null); setBestFix(null)
    setGpsState('acquiring')
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setBestFix(b => (!b || acc < b.acc) ? { lat, lng, acc } : b)
        if (acc <= 15) lockGPS({ lat, lng, acc })
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    )
    setTimeout(() => {
      if (watchRef.current) {
        navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null
        setBestFix(b => { if (b) lockGPS(b); else setGpsState('failed'); return b })
      }
    }, 12000)
  }

  function lockGPS(fix) {
    stopWatch()
    setGPS(fix)
    setGpsState('locked')
  }

  function stopWatch() {
    if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
  }

  async function saveCapture() {
    if (!gps || !activeJourney) return
    setSaving(true)
    try {
      const cap = await taApi.addCapture(activeJourney.id, {
        lat: gps.lat, lng: gps.lng, acc: gps.acc, note: captureNote,
      }, substationLat, substationLng)
      setJs(s => ({ ...s, captures: [...(s.captures||[]), cap] }))
      setGPS(null); setBestFix(null); setGpsState('idle'); setCaptureNote('')
      toast(`📍 Point #${cap.seq_number} captured — ${cap.distance_km}km from substation`, 'ok')
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  // ── Complete journey ─────────────────────────────────────────
  async function finishJourney() {
    if (!activeJourney) return
    if (captures.length === 0) {
      if (!confirm('No positions captured. Complete journey anyway?')) return
    }
    const maxDist = captures.reduce((m, c) => Math.max(m, c.distance_km || 0), 0)
    setSaving(true)
    try {
      const done = await taApi.completeJourney(activeJourney.id, maxDist)
      toast(maxDist >= 15
        ? `✅ Journey complete — ${maxDist}km traveled — TA ELIGIBLE`
        : `Journey complete — ${maxDist}km traveled — below 15km threshold`,
        maxDist >= 15 ? 'ok' : 'warn')
      clearJourney()
      loadJourneys()
      setView('list')
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  // ── View journey detail ──────────────────────────────────────
  async function openJourney(j) {
    try {
      const full = await taApi.getJourney(j.id)
      setViewingJourney(full)
      setView('view')
    } catch(e) { toast(e.message, 'err') }
  }

  async function deleteJourney(j) {
    if (!confirm(`Delete journey ${j.journey_number}? This cannot be undone.`)) return
    try {
      await taApi.deleteJourney(j.id)
      setJourneys(prev => prev.filter(x => x.id !== j.id))
      toast('🗑 Deleted', 'ok')
    } catch(e) { toast(e.message, 'err') }
  }

  // ── PDF generation ───────────────────────────────────────────
  async function generatePDF(journey) {
    try {
      const full = journey.captures ? journey : await taApi.getJourney(journey.id)
      const { jsPDF } = await import('jspdf').then(m => ({ jsPDF: m.jsPDF || m.default?.jsPDF || m.default }))
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const W = 210, M = 14

      // Header
      doc.setFillColor(7,16,30); doc.rect(0,0,W,32,'F')
      doc.setTextColor(0,212,255); doc.setFontSize(13); doc.setFont('helvetica','bold')
      doc.text(`${org?.name || ''} — ${org?.division || ''}`, W/2, 11, { align:'center' })
      doc.setFontSize(11); doc.setTextColor(255,255,255)
      doc.text('TRAVEL ALLOWANCE — TOUR ROUTE REPORT', W/2, 19, { align:'center' })
      doc.setFontSize(9); doc.setTextColor(180,200,220)
      doc.text(full.journey_number, W/2, 27, { align:'center' })

      // Meta info
      let y = 42
      const meta = [
        ['Journey No.', full.journey_number],
        ['User', `${full.profiles?.name||'—'} (${full.profiles?.employee_id||''})`],
        ['Role', (full.profiles?.role||'').toUpperCase()],
        ['Date', new Date(full.journey_date||full.start_time).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})],
        ['Start Time', new Date(full.start_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})],
        ['End Time', full.end_time ? new Date(full.end_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—'],
        ['Purpose', full.purpose],
        ['Serving Sub-Station', full.substation_name || full.substations?.name || '—'],
      ]
      doc.setFontSize(8)
      meta.forEach(([k,v]) => {
        y += 6
        doc.setFont('helvetica','bold'); doc.setTextColor(80,80,80); doc.text(k+':', M, y)
        doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)
        const lines = doc.splitTextToSize(String(v||'—'), W-M-50)
        doc.text(lines, M+45, y)
        if (lines.length > 1) y += (lines.length-1) * 5
      })

      // Eligibility badge
      y += 8
      const maxDist = full.max_distance_km || captures.reduce((m,c)=>Math.max(m,c.distance_km||0),0)
      const eligible = maxDist >= 15
      doc.setFillColor(...(eligible ? [16,185,129] : [245,158,11]))
      doc.roundedRect(M, y-5, W-2*M, 14, 2, 2, 'F')
      doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.setFontSize(10)
      doc.text(
        eligible
          ? `✓ TA ELIGIBLE — Maximum distance traveled: ${maxDist.toFixed(2)} km (exceeds 15km threshold)`
          : `⚠ NOT ELIGIBLE — Maximum distance traveled: ${maxDist.toFixed(2)} km (below 15km threshold)`,
        W/2, y+3, { align:'center' }
      )

      // Geo-coordinate log table
      y += 18
      doc.setFillColor(7,16,30); doc.rect(M, y-5, W-2*M, 8, 'F')
      doc.setFont('helvetica','bold'); doc.setTextColor(0,212,255); doc.setFontSize(7.5)
      const cols = ['#','Time','Latitude','Longitude','Accuracy','Dist. from Substation','Note']
      const cw = [8,20,28,28,18,40, W-2*M-142]
      let cx = M
      cols.forEach((c,i) => { doc.text(c, cx+1, y); cx += cw[i] })
      y += 3

      doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20)

      // Origin row (substation)
      y += 6.5
      doc.setFillColor(230,245,255); doc.rect(M, y-4.5, W-2*M, 6.5, 'F')
      cx = M
      const originRow = ['0', new Date(full.start_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
        full.substation_lat?.toFixed(5)+'°N', full.substation_lng?.toFixed(5)+'°E', '—', '0.00 km (Origin)', full.substation_name||'']
      doc.setFontSize(7)
      originRow.forEach((v,i) => { doc.text(String(v), cx+1, y); cx += cw[i] })

      ;(full.captures||[]).forEach((c, idx) => {
        y += 6.5
        if (y > 265) { doc.addPage(); y = 20 }
        if (idx % 2 === 0) { doc.setFillColor(248,250,252); doc.rect(M, y-4.5, W-2*M, 6.5, 'F') }
        cx = M
        const row = [
          String(c.seq_number),
          new Date(c.captured_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
          parseFloat(c.latitude).toFixed(5)+'°N',
          parseFloat(c.longitude).toFixed(5)+'°E',
          c.accuracy_m ? '±'+Math.round(c.accuracy_m)+'m' : '—',
          (c.distance_km!=null ? c.distance_km.toFixed(2)+' km' : '—'),
          (c.note||'').slice(0,30),
        ]
        doc.setFontSize(7)
        row.forEach((v,i) => { doc.text(String(v), cx+1, y); cx += cw[i] })
      })

      // Footer — signature blocks
      const footY = 270
      if (y > footY - 10) { doc.addPage() }
      const sigY = doc.internal.getNumberOfPages() > 1 ? 270 : Math.max(y + 20, footY)

      doc.setDrawColor(28,53,80); doc.setLineWidth(0.3)
      doc.line(M, sigY, M+70, sigY)
      doc.line(W-M-70, sigY, W-M, sigY)
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(60,60,60)
      doc.text('Signature of Concerned User', M, sigY+5)
      doc.text(full.profiles?.name || '', M, sigY+10)
      doc.text('Signature of AE / Approving Officer', W-M-70, sigY+5)

      doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`${full.journey_number} · GeoAsset TA Module · Generated: ${new Date().toLocaleString('en-IN')}`, W/2, 290, { align:'center' })

      doc.save(`${full.journey_number}_TourRoute.pdf`)
      toast('📄 PDF downloaded', 'ok')
    } catch(e) { console.error(e); toast('PDF error: ' + e.message, 'err') }
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
  const maxDistSoFar = captures.reduce((m,c)=>Math.max(m,c.distance_km||0),0)

  // ── LIST VIEW ────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd flex items-center justify-between">
        <div>
          <div className="font-rajdhani font-bold text-sm">🚗 Travel Allowance</div>
          <div className="text-[10px] text-mu mt-0.5">{journeys.length} journeys · &gt;15km = eligible</div>
        </div>
        <button onClick={() => hasActiveJourney ? toast('Finish active journey first', 'warn') : setView('new')}
          className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
          + New Journey
        </button>
      </div>

      {hasActiveJourney && activeJourney && (
        <div className="mx-3 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-amber-400 font-bold text-sm">🚗 Journey In Progress</div>
            <div className="text-[10px] text-mu">{activeJourney.journey_number} · {captures.length} points · {maxDistSoFar.toFixed(1)}km max</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('active')}
              className="px-3 py-1.5 rounded-xl bg-a/10 border border-a/30 text-a text-[10px] font-bold">
              Resume →
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-center py-8 text-mu text-sm animate-pulse">Loading…</div>}
        {!loading && journeys.length === 0 && (
          <div className="text-center py-16 text-mu">
            <div className="text-5xl mb-3">🚗</div>
            <div className="text-sm">No journeys yet</div>
            <div className="text-xs mt-1">Start tracking your field travel for TA</div>
          </div>
        )}
        {journeys.map(j => (
          <div key={j.id} className="bg-sf border border-bd rounded-2xl p-4 cursor-pointer hover:border-a/50 transition-colors"
            onClick={() => openJourney(j)}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-a font-bold">{j.journey_number}</div>
                <div className="font-semibold text-sm mt-0.5 truncate">{j.purpose}</div>
                <div className="text-[10px] text-mu mt-0.5">🏭 {j.substation_name} · {j.profiles?.name}</div>
              </div>
              <span className={`text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 ml-2
                ${j.status==='active' ? 'bg-amber-500/20 text-amber-400' : j.is_eligible ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-mu'}`}>
                {j.status==='active' ? 'ACTIVE' : j.is_eligible ? '✓ ELIGIBLE' : 'NOT ELIGIBLE'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-mu">
              <span>{new Date(j.journey_date||j.start_time).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>
              <span className="font-mono font-bold" style={{color: j.is_eligible?'#10b981':'#4e7090'}}>
                {(j.max_distance_km||0).toFixed(2)} km
              </span>
            </div>
            {j.status==='completed' && (
              <button onClick={(e)=>{e.stopPropagation(); generatePDF(j)}}
                className="w-full mt-3 py-2 rounded-xl border border-a/30 bg-a/10 text-a text-xs font-bold">
                📄 Download PDF
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  // ── NEW JOURNEY ──────────────────────────────────────────────
  if (view === 'new') return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setView('list')} className="text-mu text-sm">← Back</button>
        <div className="font-rajdhani font-bold text-a">New TA Journey</div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3">
        <div>
          <label className="text-[10px] text-mu block mb-1">Serving Sub-Station *</label>
          <select className={inp} value={form.substationId} onChange={e=>setForm({...form,substationId:e.target.value})}>
            <option value="">Select your substation…</option>
            {substations.map(s => (
              <option key={s.id} value={s.id} disabled={!s.latitude}>
                {s.code} — {s.name} {!s.latitude ? '(no GPS surveyed)' : ''}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-mu mt-1">Distance will be measured from this substation's surveyed location</div>
        </div>
        <div>
          <label className="text-[10px] text-mu block mb-1">Purpose of Travel *</label>
          <textarea className={inp} rows={3} placeholder="e.g. Field inspection of feeder F-04, site visit for new connection survey…"
            value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} />
        </div>
        <div className="bg-sf2 border border-bd rounded-xl p-3 text-[10px] text-mu">
          📋 Journey number auto-generated: <span className="font-mono text-a">TA-{new Date().getFullYear()}-0001</span><br/>
          ⏰ Capture window: 8:00 AM – 8:00 PM<br/>
          ✅ Eligibility threshold: 15 km from serving substation
        </div>
      </div>
      <div className="flex gap-3 mt-4 flex-shrink-0">
        <button onClick={() => setView('list')} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
        <button onClick={startJourney} disabled={saving}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
          {saving ? '⏳…' : '🚗 Start Journey'}
        </button>
      </div>
    </div>
  )

  // ── ACTIVE JOURNEY ───────────────────────────────────────────
  if (view === 'active' && activeJourney) {
    const gpsColor = gpsState==='locked'?'#10b981':gpsState==='acquiring'?'#f59e0b':gpsState==='failed'?'#ef4444':'#4e7090'
    return (
      <div className="h-full flex flex-col">
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="font-rajdhani font-bold text-sm text-amber-400">JOURNEY ACTIVE</span>
              </div>
              <div className="text-xs text-mu">{activeJourney.journey_number} · 🏭 {activeJourney.substation_name}</div>
            </div>
            <div className="text-right">
              <div className="font-mono font-bold text-lg" style={{color: maxDistSoFar>=15?'#10b981':'#f59e0b'}}>
                {maxDistSoFar.toFixed(2)}km
              </div>
              <div className="text-[9px] text-mu">max distance</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Origin */}
          <div className="flex items-center gap-3 p-3 bg-sf2 border border-a/30 rounded-xl">
            <div className="w-8 h-8 rounded-xl bg-a/20 flex items-center justify-center text-base">🏭</div>
            <div className="flex-1">
              <div className="text-sm font-bold">Origin: {activeJourney.substation_name}</div>
              <div className="text-[10px] text-mu font-mono">{substationLat?.toFixed(5)}°N, {substationLng?.toFixed(5)}°E</div>
            </div>
          </div>

          {captures.length === 0 && (
            <div className="text-center py-8 text-mu text-sm">
              Travel to your destination, then tap "Capture Position" below
            </div>
          )}

          {captures.map((c, i) => (
            <div key={c.id||i} className="flex items-center gap-3 p-3 bg-sf border border-bd rounded-xl">
              <div className="w-8 h-8 rounded-xl bg-bg flex items-center justify-center text-sm font-bold text-a">{c.seq_number}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono">{parseFloat(c.latitude).toFixed(5)}°N, {parseFloat(c.longitude).toFixed(5)}°E</div>
                <div className="text-[10px] text-mu">{new Date(c.captured_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}{c.note ? ' · '+c.note : ''}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-mono font-bold text-sm" style={{color: (c.distance_km||0)>=15 ? '#10b981':'#f59e0b'}}>
                  {c.distance_km?.toFixed(2)}km
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-bd flex-shrink-0 space-y-3">
          <button onClick={() => { startGPS(); setCaptureNote('') }}
            className="w-full py-4 rounded-2xl font-rajdhani font-bold text-lg"
            style={{ background:'linear-gradient(135deg,#f59e0b,#f97316)', color:'#07101e' }}>
            📍 Capture Position
          </button>
          <button onClick={finishJourney} disabled={saving}
            className="w-full py-3 rounded-2xl border-2 border-green-500/40 bg-green-500/10 text-green-400 font-rajdhani font-bold">
            {saving ? '⏳…' : '✅ Finish Journey'}
          </button>
        </div>

        {/* GPS Capture Modal */}
        {(gpsState !== 'idle') && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-5">
            <div className="w-full max-w-sm bg-sf border-2 rounded-3xl p-6 text-center" style={{borderColor:gpsColor+'66'}}>
              <div className="text-5xl mb-3">{gpsState==='locked'?'✅':gpsState==='failed'?'❌':'📡'}</div>
              <div className="font-rajdhani font-bold text-xl mb-1" style={{color:gpsColor}}>
                {gpsState==='locked'?'GPS Locked':gpsState==='failed'?'GPS Failed':'Acquiring GPS…'}
              </div>

              {gpsState === 'acquiring' && bestFix && (
                <div className="my-4">
                  <div className="font-mono text-sm" style={{color:gpsColor}}>±{Math.round(bestFix.acc)}m</div>
                  <button onClick={() => lockGPS(bestFix)}
                    className="mt-3 w-full py-2 rounded-xl border text-sm font-bold" style={{borderColor:gpsColor+'66',color:gpsColor}}>
                    🔒 Lock Best Fix
                  </button>
                </div>
              )}

              {gpsState === 'locked' && gps && (
                <div className="bg-bg rounded-2xl p-4 my-4 font-mono text-sm text-left">
                  <div className="text-a">{gps.lat.toFixed(6)}°N</div>
                  <div className="text-a">{gps.lng.toFixed(6)}°E</div>
                  <div className="text-green-400 text-xs mt-1">±{Math.round(gps.acc)}m accuracy</div>
                  {substationLat && (
                    <div className="text-amber-400 text-xs mt-2 pt-2 border-t border-bd">
                      ~{taApi.haversineKm(substationLat, substationLng, gps.lat, gps.lng).toFixed(2)}km from substation
                    </div>
                  )}
                  <input className="w-full mt-3 bg-sf2 border border-bd rounded-xl px-3 py-2 text-xs text-tx"
                    placeholder="Note (optional) — e.g. site name"
                    value={captureNote} onChange={e=>setCaptureNote(e.target.value)} />
                </div>
              )}

              {gpsState === 'failed' && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 my-4 text-xs text-red-400">
                  Could not get GPS lock. Move to open area and retry.
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { stopWatch(); setGpsState('idle'); setGPS(null) }}
                  className="flex-1 py-3 rounded-2xl border border-bd text-mu font-bold">Cancel</button>
                {gpsState === 'locked' ? (
                  <button onClick={saveCapture} disabled={saving}
                    className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold">
                    {saving ? '⏳…' : '✅ Save Point'}
                  </button>
                ) : gpsState === 'failed' ? (
                  <button onClick={startGPS} className="flex-1 py-3 rounded-2xl border border-a/40 text-a font-bold">Retry</button>
                ) : (
                  <button disabled className="flex-1 py-3 rounded-2xl bg-a/20 text-a/50 font-bold">Waiting…</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── VIEW JOURNEY DETAIL ──────────────────────────────────────
  if (view === 'view' && viewingJourney) {
    const maxD = viewingJourney.max_distance_km || 0
    return (
      <div className="h-full flex flex-col">
        <div className="p-3 border-b border-bd flex-shrink-0 flex items-center gap-3">
          <button onClick={()=>{setView('list');setViewingJourney(null)}} className="text-mu text-sm">←</button>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs text-a">{viewingJourney.journey_number}</div>
            <div className="text-sm font-semibold truncate">{viewingJourney.purpose}</div>
          </div>
          <button onClick={()=>generatePDF(viewingJourney)}
            className="px-3 py-1.5 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
            📄 PDF
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className={`rounded-2xl p-4 text-center ${maxD>=15?'bg-green-500/10 border border-green-500/30':'bg-amber-500/10 border border-amber-500/30'}`}>
            <div className="text-3xl mb-1">{maxD>=15?'✅':'⚠️'}</div>
            <div className="font-rajdhani font-bold text-xl" style={{color:maxD>=15?'#10b981':'#f59e0b'}}>
              {maxD.toFixed(2)} km
            </div>
            <div className="text-xs text-mu">{maxD>=15?'TA Eligible':'Below 15km threshold'}</div>
          </div>
          <div className="bg-sf border border-bd rounded-2xl p-4 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-mu">User</span><span>{viewingJourney.profiles?.name}</span></div>
            <div className="flex justify-between"><span className="text-mu">Substation</span><span>🏭 {viewingJourney.substation_name}</span></div>
            <div className="flex justify-between"><span className="text-mu">Date</span><span>{new Date(viewingJourney.journey_date||viewingJourney.start_time).toLocaleDateString('en-IN')}</span></div>
          </div>
          <div className="font-rajdhani font-bold text-xs text-a">GEO-COORDINATE LOG ({(viewingJourney.captures||[]).length} points)</div>
          {(viewingJourney.captures||[]).map((c,i) => (
            <div key={c.id||i} className="flex items-center gap-3 p-3 bg-sf border border-bd rounded-xl text-xs">
              <div className="w-7 h-7 rounded-lg bg-bg flex items-center justify-center font-bold text-a">{c.seq_number}</div>
              <div className="flex-1 font-mono">{parseFloat(c.latitude).toFixed(5)}°N, {parseFloat(c.longitude).toFixed(5)}°E</div>
              <div className="font-mono font-bold" style={{color:(c.distance_km||0)>=15?'#10b981':'#f59e0b'}}>{c.distance_km?.toFixed(2)}km</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
}
