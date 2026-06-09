import React, { useState, useRef, useEffect } from 'react'
import { usePersistentSession } from '../../hooks/usePersistentState.js'
import { useNavigate } from 'react-router-dom'
import { useAssetStore, useFeederStore, useAuthStore, useUIStore } from '../../store/index.js'
import { assetsApi, nearbyApi, auditApi } from '../../api/client.js'
import { ASSET_TYPES, GPS_GOOD, GPS_OK, gpsColorClass } from '../../utils/constants.js'

const STEPS = ['gps', 'type', 'feeder', 'details', 'confirm']

// Only meter K.No. is manual — all other numbers are auto-generated
const ASSET_FIELDS = {
  pole:   [{ id:'pole_type', label:'Type', type:'select', options:['PCC','PSC','Wood','GI'] },
           { id:'height_m', label:'Height', type:'select', options:['7.5m','9m','11m','13m'] },
           { id:'line_type', label:'Line', type:'select', options:['LT Line','HT 11kV','HT 33kV'] }],
  dtr:    [{ id:'capacity_kva', label:'Capacity', type:'select', options:['25','63','100','160','200','250','315','400'] },
           { id:'voltage_ratio', label:'Voltage', type:'select', options:['11kV/433V','33kV/11kV'] },
           { id:'present_load_pct', label:'Load %', type:'number', placeholder:'65' },
           { id:'consumers_count', label:'Consumers', type:'number', placeholder:'48' }],
  meter:  [{ id:'k_number', label:'K. Number (required)', placeholder:'K-00123456', required:true },
           { id:'consumer_name', label:'Consumer Name', placeholder:'Ram Prasad' },
           { id:'category', label:'Category', type:'select', options:['DS','NS','AG','IP','LT_I','SL'] },
           { id:'mobile', label:'Mobile', placeholder:'9414511001', type:'tel' },
           { id:'outstanding_amount', label:'Outstanding ₹', type:'number', placeholder:'0' }],
  line:   [{ id:'from_pole', label:'From Pole No.', placeholder:'P-0247', required:true },
           { id:'to_pole', label:'To Pole No.', placeholder:'P-0248', required:true },
           { id:'line_type', label:'Type', type:'select', options:['LT Line','HT 11kV','HT 33kV'] }],
  pillar: [{ id:'unit_type', label:'Type', type:'select', options:['Feeder Pillar','Ring Main Unit','Distribution Box'] },
           { id:'rating_amps', label:'Rating (A)', type:'number', placeholder:'200' }],
  substation: [
    { id:'substation_name', label:'Substation Name', placeholder:'33/11kV GSS Jhalawar', required:true },
    { id:'capacity_mva', label:'Capacity (MVA)', type:'number', placeholder:'10' },
    { id:'voltage_ratio', label:'Voltage Ratio', type:'select', options:['33/11kV','132/33kV','132/11kV','220/33kV'] },
    { id:'num_feeders', label:'No. of Feeders', type:'number', placeholder:'8' },
    { id:'num_consumers', label:'No. of Consumers', type:'number', placeholder:'5000' },
    { id:'present_load_mva', label:'Present Load (MVA)', type:'number', placeholder:'6.5' },
    { id:'switchgear_type', label:'Switchgear', type:'select', options:['Indoor','Outdoor','GIS','Hybrid'] },
    { id:'num_vcb', label:'No. of VCBs', type:'number', placeholder:'12' },
    { id:'num_pcb', label:'No. of PCBs', type:'number', placeholder:'4' },
    { id:'village', label:'Village', placeholder:'Jhalawar' },
    { id:'tehsil', label:'Tehsil', placeholder:'Jhalawar' },
    { id:'jen_office', label:'JEN Office', placeholder:'JEN Office Jhalawar' },
    { id:'subdivision_name', label:'Sub-Division', placeholder:'SD-03' },
  ],
  linedp: [
    { id:'dp_type', label:'DP Type', type:'select', options:['T-Off Point','Straight Junction','Corner Junction','4-Way Junction'] },
    { id:'line_type', label:'Line Type', type:'select', options:['LT Line','HT 11kV','HT 33kV'] },
    { id:'phase', label:'Phase', type:'select', options:['Single Phase','Three Phase'] },
    { id:'connected_dtr', label:'Connected DTR', placeholder:'DTR-0142' },
    { id:'num_outgoing', label:'No. of Outgoing', type:'number', placeholder:'3' },
  ],
  iso:    [{ id:'iso_type', label:'Type', type:'select', options:['ABS','DOF','Gang','RMU'] },
           { id:'voltage_level', label:'Voltage', type:'select', options:['HT 11kV','HT 33kV','LT'] },
           { id:'present_status', label:'Status', type:'select', options:['Closed','Open','Faulty'] }],
}

export default function MobileSurveyPage() {
  const navigate = useNavigate()
  const { assets, fetch: fetchAssets, add: addAsset, remove } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile } = useAuthStore()
  const { toast } = useUIStore()

  // ── Persistent session ── survives tab switches until saved/discarded ──
  const { session: sv, setSession: setSv, clearSession, hasDraft } = usePersistentSession(
    'geoasset_mobile_survey_draft',
    { step: 'gps', gps: null, gpsAcc: null, assetType: null, feederId: '', fields: {} }
  )

  // Derive from session
  const step       = sv.step       || 'gps'
  const gps        = sv.gps
  const gpsAcc     = sv.gpsAcc
  const assetType  = sv.assetType
  const feederId   = sv.feederId
  const fields     = sv.fields     || {}

  // Setters through persistent session
  const setStep      = (v) => setSv({ step: v })
  const setGPS       = (v) => setSv({ gps: v })
  const setGpsAcc    = (v) => setSv({ gpsAcc: v })
  const setAssetType = (v) => setSv({ assetType: v, fields: {}, step: 'feeder' })
  const setFeederId  = (v) => setSv({ feederId: v })
  const setFields    = (fn) => setSv(s => ({ ...s, fields: typeof fn === 'function' ? fn(s.fields||{}) : { ...(s.fields||{}), ...fn } }))

  // Local-only transient state
  const [bestFix, setBestFix] = useState(null)
  const [gpsState, setGpsState] = useState(gps ? 'locked' : 'idle')
  const [saving, setSaving] = useState(false)
  const [nearbyModal, setNearbyModal] = useState(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const mapPickerRef = useRef(null)
  const lmapRef = useRef(null)
  const [pickedCoords, setPickedCoords] = useState(null)
  const watchRef = useRef(null)

  useEffect(() => { return () => stopWatch() }, [])

  function stopWatch() {
    if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
  }

  function startGPS() {
    if (!navigator.geolocation) { setGpsState('failed'); return }
    stopWatch()
    setBestFix(null); setGPS(null)
    setGpsState('acquiring')

    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setBestFix(b => (!b || acc < b.acc) ? { lat, lng, acc } : b)
        setGpsAcc(acc)
        if (acc <= 5) lockGPS({ lat, lng, acc })
      },
      () => { stopWatch(); setGpsState('failed') },
      { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 }
    )
    setTimeout(() => {
      if (watchRef.current) {
        stopWatch()
        setBestFix(b => { if (b) { lockGPS(b) } else { setGpsState('failed') } return b })
      }
    }, 15000)
  }

  function lockGPS(fix) {
    stopWatch()
    setSv({ gps: fix, gpsAcc: fix.acc })
    setGpsState('locked')
  }

  function openMapPicker() {
    setShowMapPicker(true)
    setTimeout(() => {
      if (!mapPickerRef.current || lmapRef.current) return
      import('leaflet').then(L => {
        const center = bestFix ? [bestFix.lat, bestFix.lng] : [24.5963, 76.169]
        const map = L.map(mapPickerRef.current, { center, zoom: 17, zoomControl: false })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map)
        assets.filter(a => a.asset_type !== 'line').forEach(a => {
          L.circleMarker([parseFloat(a.latitude), parseFloat(a.longitude)],
            { radius: 5, color: ASSET_TYPES[a.asset_type]?.color, fillOpacity: 0.8, weight: 1 }).addTo(map)
        })
        let pin = null
        map.on('click', e => {
          if (pin) map.removeLayer(pin)
          pin = L.marker([e.latlng.lat, e.latlng.lng], {
            draggable: true,
            icon: L.divIcon({ className: '', html: '<div style="width:20px;height:20px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.6)"></div>', iconSize:[20,20], iconAnchor:[10,10] })
          }).addTo(map)
          pin.on('dragend', e2 => { const ll=e2.target.getLatLng(); setPickedCoords({lat:ll.lat,lng:ll.lng}) })
          setPickedCoords({ lat: e.latlng.lat, lng: e.latlng.lng })
        })
        lmapRef.current = map
      })
    }, 200)
  }

  function confirmMapPin() {
    if (!pickedCoords) return toast('Tap map to place pin','err')
    setSv({ gps: { ...pickedCoords, acc: 10 }, gpsAcc: 10 })
    setGpsState('locked')
    setShowMapPicker(false); lmapRef.current = null
    toast('📍 Location set','ok')
  }

  async function save() {
    if (!gps) return toast('Set GPS location first','err')
    if (!assetType) return toast('Select asset type','err')
    const fDefs = ASSET_FIELDS[assetType] || []
    const req = fDefs.find(f => f.required && !fields[f.id])
    if (req) return toast(req.label + ' is required','err')

    // Nearby check — 20m radius
    try {
      const nearby = await nearbyApi.query(gps.lat, gps.lng, 20)
      if (nearby.length > 0) {
        setNearbyModal({ nearby, pendingPayload: { gps, assetType, feederId, fields } })
        return
      }
    } catch(e) { console.warn('Nearby check:', e) }

    await doSave(gps, assetType, feederId, fields, [])
  }

  async function doSave(gpsC, type, fdr, flds, replaceIds = []) {
    setSaving(true)
    try {
      for (const id of replaceIds) {
        await assetsApi.delete(id)
        remove(id)
      }
      const { outstanding_amount, mobile: mob, _remarks, ...detailsOnly } = flds
      const name = type==='meter'
        ? flds.k_number
        : type==='line'
          ? (flds.from_pole||'?')+'→'+(flds.to_pole||'?')
          : (type.toUpperCase()+'-TMP')
      let saved = await assetsApi.create({
        asset_type: type, name,
        latitude: gpsC.lat, longitude: gpsC.lng, survey_accuracy_m: gpsC.acc,
        feeder_id: fdr || null, surveyed_by_id: profile?.id,
        details: detailsOnly,
        remarks: _remarks || null,
        outstanding_amount: type==='meter' ? (parseFloat(outstanding_amount)||0) : 0,
        mobile: type==='meter' ? (mob||null) : null,
      })
      if (type !== 'meter' && type !== 'line' && saved.asset_code) {
        saved = await assetsApi.update(saved.id, { name: saved.asset_code })
      }
      addAsset(saved)
      try {
        await auditApi.log({
          action: replaceIds.length ? 'RESURVEY' : 'SURVEY',
          category: 'survey',
          severity: replaceIds.length ? 'warn' : 'info',
          description: replaceIds.length
            ? `Resurveyed: ${saved.asset_code} replaced ${replaceIds.length} asset(s)`
            : `New asset surveyed: ${saved.asset_code} (${type})`,
          meta: { asset_id: saved.id, lat: gpsC.lat, lng: gpsC.lng, replaced_ids: replaceIds },
        })
      } catch(auditErr) { console.warn('Audit log failed (non-blocking):', auditErr) }
      toast('✅ ' + saved.asset_code + ' saved','ok')
      clearSession()
      setGpsState('idle'); setBestFix(null)
      setNearbyModal(null)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }



  // ── Nearby modal ─────────────────────────────────────────
  if (nearbyModal) {
    const { nearby, pendingPayload: pp } = nearbyModal
    const [nearbyChoice, setNearbyChoice] = useState('new') // 'new' | assetId
    const chosenAsset = nearbyChoice !== 'new' ? nearby.find(a=>a.id===nearbyChoice) : null

    return (
      <div className="h-full flex flex-col p-4">
        <div className="text-center pt-4 mb-4">
          <div className="text-5xl mb-2">ℹ️</div>
          <div className="font-rajdhani font-bold text-xl text-a">Assets Already Here</div>
          <div className="text-mu text-sm mt-1">
            {nearby.length} asset(s) surveyed within 20m of this location
          </div>
        </div>

        {/* Nearby list — info only */}
        <div className="bg-sf border border-bd rounded-2xl p-3 mb-4 space-y-2 max-h-48 overflow-y-auto flex-shrink-0">
          {nearby.map(a => (
            <div key={a.id} className="flex items-center gap-3 py-1">
              <span className="text-xl flex-shrink-0">{ASSET_TYPES[a.asset_type]?.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{a.name}</div>
                <div className="text-[10px] text-mu">{ASSET_TYPES[a.asset_type]?.label} · {a.asset_code}</div>
                <div className="font-mono text-[10px] text-a">{parseFloat(a.latitude).toFixed(5)}°N · {parseFloat(a.longitude).toFixed(5)}°E</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-mono font-bold text-base text-amber-400">{a.distance_m}m</div>
              </div>
            </div>
          ))}
        </div>

        {/* Question */}
        <div className="font-rajdhani font-bold text-sm text-tx mb-3 flex-shrink-0">
          What are you surveying?
        </div>

        {/* Choice buttons */}
        <div className="space-y-2 flex-1 overflow-y-auto">
          {/* Option A — New asset */}
          <button onClick={() => setNearbyChoice('new')}
            className={`w-full p-4 rounded-2xl border-2 text-left transition-all
              ${nearbyChoice==='new' ? 'border-a bg-a/10' : 'border-bd bg-sf'}`}>
            <div className={`font-bold text-base ${nearbyChoice==='new'?'text-a':'text-tx'}`}>
              ✨ A NEW asset at this location
            </div>
            <div className="text-xs text-mu mt-1">
              e.g. a meter near an existing pole — both will coexist
            </div>
          </button>

          {/* Option B — Update an existing asset */}
          {nearby.map(a => {
            const cfg = ASSET_TYPES[a.asset_type]
            const isChosen = nearbyChoice === a.id
            return (
              <button key={a.id} onClick={() => setNearbyChoice(a.id)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all
                  ${isChosen ? 'border-amber-500 bg-amber-500/10' : 'border-bd bg-sf'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl flex-shrink-0">{cfg?.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold text-base ${isChosen?'text-amber-400':'text-tx'}`}>
                      🔄 Update: {a.name}
                    </div>
                    <div className="text-xs text-mu">{cfg?.label} · {a.asset_code} · {a.distance_m}m away</div>
                    <div className="text-[10px] text-red-400 mt-1">
                      ⚠️ This will replace the existing survey data for this asset
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-4 flex-shrink-0">
          <button onClick={() => setNearbyModal(null)}
            className="px-5 py-4 rounded-2xl border border-bd text-mu font-rajdhani font-bold">
            ← Back
          </button>
          <button onClick={() => {
            setNearbyModal(null)
            if (nearbyChoice === 'new') {
              // Proceed normally — no deletion
              doSave(pp.gps, pp.assetType, pp.feederId, pp.fields, [])
            } else {
              // Delete chosen asset only, then save new
              auditApi.log({ action:'RESURVEY', category:'survey', severity:'warn',
                description:`Asset ${chosenAsset?.asset_code} resurveyed by user choice`,
                meta: { replaced_id: nearbyChoice, nearby_count: nearby.length } })
              doSave(pp.gps, pp.assetType, pp.feederId, pp.fields, [nearbyChoice])
            }
          }}
            className="flex-1 py-4 rounded-2xl font-rajdhani font-bold text-lg"
            style={{background:'linear-gradient(135deg,#00d4ff,#3b82f6)',color:'#07101e'}}>
            {nearbyChoice==='new' ? '✨ Add New Asset' : '🔄 Update & Replace'}
          </button>
        </div>
      </div>
    )
  }

  const gpsCol = gps ? gpsColorClass(gpsAcc||99) : '#4e7090'
  const inp = "w-full bg-bg border border-bd rounded-2xl px-4 py-4 text-base text-tx focus:outline-none focus:border-a transition-colors"

  // STEP: GPS
  if (step === 'gps') return (
    <div className="h-full flex flex-col p-4 gap-4">
      {hasDraft && gps && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-amber-400 font-bold text-sm">📋 Draft Survey Resumed</div>
            <div className="text-[11px] text-mu mt-0.5">
              GPS: ±{Math.round(gpsAcc||0)}m locked · {assetType ? 'Type: '+assetType : 'Select type →'}
            </div>
          </div>
          <button onClick={()=>{ clearSession(); setGpsState('idle') }}
            className="px-3 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold">
            🗑 Discard
          </button>
        </div>
      )}
      <div className="text-center pt-4">
        <div className="font-rajdhani text-a font-bold text-xl tracking-widest">STEP 1 OF 4</div>
        <div className="text-tx text-2xl font-bold mt-1">Get Location</div>
        <div className="text-mu text-sm mt-1">Stand at the asset location</div>
      </div>

      {/* GPS status circle */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className={`w-40 h-40 rounded-full border-4 flex flex-col items-center justify-center
            ${gpsState==='acquiring' ? 'animate-pulse' : ''}`}
            style={{ borderColor: gpsCol, background: gpsCol + '11' }}>
            <span className="text-5xl">{gpsState==='locked'?'✅':gpsState==='failed'?'❌':gpsState==='acquiring'?'📡':'📍'}</span>
            {gpsState==='acquiring' && bestFix && (
              <div className="text-center mt-2">
                <div className="font-mono font-bold text-sm" style={{color:gpsColorClass(bestFix.acc)}}>±{Math.round(bestFix.acc)}m</div>
                <div className="text-[10px] text-mu">improving…</div>
              </div>
            )}
            {gpsState==='locked' && (
              <div className="text-center mt-1">
                <div className="font-mono font-bold text-sm text-green-400">±{Math.round(gpsAcc)}m</div>
                <div className="text-[10px] text-mu">LOCKED</div>
              </div>
            )}
          </div>
        </div>

        {gpsState==='locked' && gps && (
          <div className="bg-sf border border-green-500/30 rounded-2xl p-4 w-full">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-bg rounded-xl p-3">
                <div className="text-[10px] text-mu mb-1">LATITUDE</div>
                <div className="font-mono text-sm font-bold text-tx">{gps.lat.toFixed(5)}°N</div>
              </div>
              <div className="bg-bg rounded-xl p-3">
                <div className="text-[10px] text-mu mb-1">LONGITUDE</div>
                <div className="font-mono text-sm font-bold text-tx">{gps.lng.toFixed(5)}°E</div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="w-full space-y-3">
          {gpsState !== 'locked' && (
            <button onClick={startGPS}
              className="w-full py-5 rounded-2xl font-rajdhani font-bold text-lg tracking-wider"
              style={{ background: 'linear-gradient(135deg, #00d4ff, #3b82f6)', color: '#07101e' }}>
              {gpsState==='acquiring' ? '⏳ Acquiring GPS…' : '📡 Get GPS Location'}
            </button>
          )}
          {gpsState==='acquiring' && bestFix && (
            <button onClick={() => lockGPS(bestFix)}
              className="w-full py-4 rounded-2xl border-2 border-a/50 text-a font-rajdhani font-bold text-base">
              🔒 Lock Best Fix (±{Math.round(bestFix.acc)}m)
            </button>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={openMapPicker}
              className="py-4 rounded-2xl border-2 border-amber-500/40 text-amber-400 font-bold text-sm">
              🗺️ Map Pin
            </button>
            <button onClick={() => {
              const lat = prompt('Enter Latitude (e.g. 24.5963)')
              const lng = prompt('Enter Longitude (e.g. 76.1690)')
              if (lat && lng) {
                setSv({ gps:{lat:parseFloat(lat),lng:parseFloat(lng),acc:15}, gpsAcc:15 })
                setGpsState('locked')
              }
            }} className="py-4 rounded-2xl border-2 border-purple-500/40 text-purple-400 font-bold text-sm">
              ✏️ Manual
            </button>
          </div>
        </div>
      </div>

      {(gpsState === 'locked' || gps) && (
        <button onClick={() => setStep(assetType ? 'details' : 'type')}
          className="w-full py-5 rounded-2xl font-rajdhani font-bold text-xl"
          style={{ background: 'linear-gradient(135deg, #00d4ff, #3b82f6)', color: '#07101e' }}>
          Next → Select Asset Type
        </button>
      )}

      {/* Map picker overlay */}
      {showMapPicker && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg">
          <div className="flex items-center justify-between px-4 py-3 bg-sf border-b border-bd flex-shrink-0">
            <div className="font-rajdhani font-bold text-a">📌 TAP TO PLACE PIN</div>
            <div className="flex gap-2">
              <button onClick={confirmMapPin} disabled={!pickedCoords}
                className="px-4 py-2 rounded-xl bg-a text-bg font-bold text-sm disabled:opacity-40">✅ Use</button>
              <button onClick={() => { setShowMapPicker(false); lmapRef.current = null }}
                className="px-3 py-2 rounded-xl border border-bd text-mu text-sm">✕</button>
            </div>
          </div>
          <div ref={mapPickerRef} className="flex-1" />
          <div className="px-4 py-3 bg-sf border-t border-bd text-[11px] font-mono text-mu flex-shrink-0">
            {pickedCoords ? `📌 ${pickedCoords.lat.toFixed(5)}°N, ${pickedCoords.lng.toFixed(5)}°E` : 'Tap map to drop pin · Drag to adjust'}
          </div>
        </div>
      )}
    </div>
  )

  // STEP: Asset Type
  if (step === 'type') return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="text-center pt-4">
        <div className="font-rajdhani text-a font-bold text-xl tracking-widest">STEP 2 OF 4</div>
        <div className="text-tx text-2xl font-bold mt-1">Asset Type</div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-3 content-start pt-2">
        {Object.entries(ASSET_TYPES).map(([type, cfg]) => (
          <button key={type} onClick={() => setSv({ assetType: type, fields: {}, step: 'feeder' })}
            className="flex flex-col items-center justify-center gap-3 py-8 rounded-2xl border-2 transition-all active:scale-95"
            style={{ borderColor: cfg.color + '44', background: cfg.bg }}>
            <span className="text-4xl">{cfg.icon}</span>
            <span className="font-rajdhani font-bold text-base" style={{ color: cfg.color }}>{cfg.label}</span>
          </button>
        ))}
      </div>
      <button onClick={() => setStep('gps')}
        className="py-4 rounded-2xl border border-bd text-mu font-bold">← Back</button>
    </div>
  )

  // STEP: Feeder
  if (step === 'feeder') return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="text-center pt-4">
        <div className="font-rajdhani text-a font-bold text-xl tracking-widest">STEP 3 OF 4</div>
        <div className="text-tx text-2xl font-bold mt-1">Select Feeder</div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto">
        <button onClick={() => setSv({ feederId: '', step: 'details' })}
          className={`w-full py-5 rounded-2xl border-2 font-bold text-base transition-all
            ${!feederId ? 'border-a text-a' : 'border-bd text-mu'}`}>
          No Feeder / Unknown
        </button>
        {feeders.map(f => (
          <button key={f.id} onClick={() => setSv({ feederId: f.id, step: 'details' })}
            className={`w-full py-5 rounded-2xl border-2 font-bold text-base transition-all text-left px-5
              ${feederId===f.id ? 'border-a text-a' : 'border-bd text-tx'}`}>
            <div className="font-mono text-a">{f.code}</div>
            <div className="text-sm text-mu font-normal">{f.name}</div>
          </button>
        ))}
      </div>
      <button onClick={() => setStep('type')} className="py-4 rounded-2xl border border-bd text-mu font-bold">← Back</button>
    </div>
  )

  // STEP: Details
  if (step === 'details') {
    const fDefs = ASSET_FIELDS[assetType] || []
    const cfg = ASSET_TYPES[assetType]
    return (
      <div className="h-full flex flex-col p-4 gap-4">
        <div className="text-center pt-2">
          <div className="font-rajdhani text-a font-bold text-xl tracking-widest">STEP 4 OF 4</div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="text-2xl">{cfg?.icon}</span>
            <span className="text-tx text-xl font-bold">{cfg?.label} Details</span>
          </div>
          {assetType !== 'meter' && (
            <div className="text-[11px] text-a/70 mt-1">
              🔢 Asset number auto-assigned on save
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pb-2">
          <div>
            <label className="text-[11px] text-mu font-bold tracking-widest uppercase block mb-2">Remarks</label>
            <textarea className={inp} rows={2} placeholder="Any observations…"
              value={fields['_remarks']||''} onChange={e=>setFields({...fields,_remarks:e.target.value})} />
          </div>
          {fDefs.map(f => (
            <div key={f.id}>
              <label className="text-[11px] text-mu font-bold tracking-widest uppercase block mb-2">
                {f.label}{f.required?' *':''}
              </label>
              {f.type==='select' ? (
                <select className={inp} value={fields[f.id]||''} onChange={e => setFields({...fields,[f.id]:e.target.value})}>
                  <option value="">Select…</option>
                  {f.options.map(o => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type||'text'} inputMode={f.keyboard||f.type==='number'?'numeric':'text'}
                  className={inp} placeholder={f.placeholder}
                  value={fields[f.id]||''} onChange={e => setFields({...fields,[f.id]:e.target.value})} />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button onClick={() => setStep('feeder')} className="px-6 py-4 rounded-2xl border border-bd text-mu font-bold">← Back</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-4 rounded-2xl font-rajdhani font-bold text-lg disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #3b82f6)', color: '#07101e' }}>
            {saving ? '⏳ Saving…' : '✅ Save to GeoMap'}
          </button>
        </div>
      </div>
    )
  }

  return null
}
