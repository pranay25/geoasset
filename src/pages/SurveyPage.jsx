import React, { useState, useRef, useEffect } from 'react'
import { usePersistentSession } from '../hooks/usePersistentState.js'
import { useAssetStore, useFeederStore, useAuthStore, useUIStore } from '../store/index.js'
import { assetsApi, nearbyApi, auditApi } from '../api/client.js'
import NearbyChoiceModal from '../components/survey/NearbyChoiceModal.jsx'
import { ASSET_TYPES, GPS_GOOD, GPS_OK, gpsColorClass } from '../utils/constants.js'

// Only meter K.No. is manual — all other asset numbers are auto-generated
const ASSET_FIELDS = {
  pole: [
    { id:'pole_type', label:'Type', type:'select', options:['PCC','PSC','Wood','GI'] },
    { id:'height_m', label:'Height', type:'select', options:['7.5m','9m','11m','13m'] },
    { id:'line_type', label:'Line Type', type:'select', options:['LT Line','HT 11kV','HT 33kV'] },
  ],
  dtr: [
    { id:'capacity_kva', label:'Capacity (kVA)', type:'select', options:['25','63','100','160','200','250','315','400','500'] },
    { id:'voltage_ratio', label:'Voltage', type:'select', options:['11kV/433V','33kV/11kV'] },
    { id:'make', label:'Make / Year', placeholder:'BHEL/2021' },
    { id:'present_load_pct', label:'Load %', type:'number', placeholder:'65' },
    { id:'consumers_count', label:'Consumers', type:'number', placeholder:'48' },
  ],
  meter: [
    { id:'k_number', label:'K. Number (required)', placeholder:'K-00123456', required:true },
    { id:'consumer_name', label:'Consumer Name', placeholder:'Ram Prasad Meena' },
    { id:'category', label:'Category', type:'select', options:['DS','NS','AG','IP','LT_I','SL'] },
    { id:'meter_type', label:'Meter Type', type:'select', options:['Single Phase','Three Phase','Smart / AMI'] },
    { id:'meter_make', label:'Make', type:'select', options:['Genus','HPL','Secure','L&T','Landis+Gyr','Itron'] },
    { id:'mobile', label:'Mobile Number', placeholder:'9414511001', type:'tel' },
    { id:'outstanding_amount', label:'Outstanding (₹)', type:'number', placeholder:'0' },
    { id:'last_payment_date', label:'Last Payment', type:'date' },
  ],
  line: [
    { id:'from_pole', label:'From Pole No.', placeholder:'P-0247', required:true },
    { id:'to_pole', label:'To Pole No.', placeholder:'P-0248', required:true },
    { id:'line_type', label:'Line Type', type:'select', options:['LT Line','HT 11kV','HT 33kV'] },
    { id:'conductor', label:'Conductor', type:'select', options:['ACSR Weasel','ACSR Dog','ACSR Rabbit','ACSR Panther'] },
    { id:'span_length_m', label:'Span (m)', type:'number', placeholder:'60' },
  ],
  pillar: [
    { id:'unit_type', label:'Type', type:'select', options:['Feeder Pillar','Ring Main Unit','Distribution Box'] },
    { id:'outgoing_feeders', label:'Outgoing Feeders', type:'number', placeholder:'4' },
    { id:'rating_amps', label:'Rating (A)', type:'number', placeholder:'200' },
  ],
  iso: [
    { id:'iso_type', label:'Type', type:'select', options:['Air Break Switch (ABS)','Drop Out Fuse (DOF)','Gang Operated','Ring Main Unit (RMU)'] },
    { id:'voltage_level', label:'Voltage', type:'select', options:['HT 11kV','HT 33kV','LT 433V'] },
    { id:'rating_amps', label:'Rating (A)', type:'number', placeholder:'200' },
    { id:'present_status', label:'Status', type:'select', options:['Closed (Normal)','Open','Faulty'] },
  ],
}

export default function SurveyPage() {
  const { assets, fetch: fetchAssets, add: addAsset, remove } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile } = useAuthStore()
  const { toast } = useUIStore()

  // ── Persistent survey session ─────────────────────────────────
  // Survives tab switches, page refreshes, app restarts until saved/discarded
  const { session: sv, setSession: setSv, clearSession, hasDraft } = usePersistentSession(
    'geoasset_survey_draft',
    { gps: null, gpsAcc: null, assetType: null, feederId: '', fields: {} }
  )

  // Derive from session
  const gps        = sv.gps
  const gpsAcc     = sv.gpsAcc
  const assetType  = sv.assetType
  const feederId   = sv.feederId
  const fields     = sv.fields

  // Local-only (no need to persist transient UI state)
  const [bestFix, setBestFix] = useState(null)
  const [gpsState, setGpsState] = useState(gps ? 'locked' : 'standby')
  const [showInlineMap, setShowInlineMap] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [manLat, setManLat] = useState('')
  const [manLng, setManLng] = useState('')
  const [saving, setSaving] = useState(false)
  const [nearbyModal, setNearbyModal] = useState(null)

  // Setters that go through persistent session
  const setGPS      = (v) => setSv({ gps: v })
  const setGpsAcc   = (v) => setSv({ gpsAcc: v })
  const setAssetType= (v) => setSv({ assetType: v, fields: {} })
  const setFeederId = (v) => setSv({ feederId: v })
  const setField    = (id, val) => setSv(s => ({ ...s, fields: { ...s.fields, [id]: val } }))

  const watchRef = useRef(null)
  const inlineMapRef = useRef(null)
  const inlineLMapRef = useRef(null)
  const inlinePinRef = useRef(null)
  const [inlineCoords, setInlineCoords] = useState(null)

  useEffect(() => { return () => stopWatch() }, [])

  function stopWatch() {
    if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current=null }
  }

  function startGPS() {
    if (!navigator.geolocation) { openInlineMap(); return }
    stopWatch()
    setBestFix(null); setGPS(null)
    setGpsState('acquiring')
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords
        setBestFix(b => (!b||acc<b.acc) ? {lat,lng,acc} : b)
        setGpsAcc(acc)
        if (acc<=5) lockGPS({ lat,lng,acc })
      },
      err => {
        stopWatch()
        setGpsState('blocked')
        openInlineMap()
      },
      { enableHighAccuracy:true, timeout:60000, maximumAge:0 }
    )
    setTimeout(() => {
      if (watchRef.current) {
        stopWatch()
        setBestFix(b => { if(b) { lockGPS(b); return b } ; openInlineMap(); return b })
      }
    }, 15000)
  }

  function lockGPS(fix) {
    stopWatch()
    setSv({ gps: fix, gpsAcc: fix.acc })
    setGpsState('locked')
    toast(`📍 GPS locked ±${Math.round(fix.acc)}m`, 'ok')
  }

  function openInlineMap() {
    setShowInlineMap(true)
    setTimeout(() => initInlineMap(), 200)
  }

  function initInlineMap() {
    if (!inlineMapRef.current) return
    if (inlineLMapRef.current) { setTimeout(()=>inlineLMapRef.current?.invalidateSize(), 100); return }
    import('leaflet').then(L => {
      if (inlineLMapRef.current) { inlineLMapRef.current.invalidateSize(); return }
      const center = [bestFix?.lat||24.5963, bestFix?.lng||76.169]
      const map = L.map(inlineMapRef.current, { center, zoom:17, zoomControl:true, tap:true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution:'© OSM', maxZoom:21 }).addTo(map)
      assets.filter(a=>a.asset_type!=='line').forEach(a => {
        L.circleMarker([parseFloat(a.latitude),parseFloat(a.longitude)],
          { radius:4, color:ASSET_TYPES[a.asset_type]?.color||'#888', fillOpacity:0.8, weight:1 })
          .addTo(map)
      })
      map.on('click', e => {
        if (inlinePinRef.current) map.removeLayer(inlinePinRef.current)
        const pin = L.marker([e.latlng.lat,e.latlng.lng], {
          draggable: true,
          icon: L.divIcon({
            className:'',
            html:'<div style="width:16px;height:16px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.6);"></div>',
            iconSize:[16,16], iconAnchor:[8,8]
          })
        }).addTo(map)
        pin.on('dragend', e2 => {
          const ll = e2.target.getLatLng()
          setInlineCoords({ lat:ll.lat, lng:ll.lng })
        })
        inlinePinRef.current = pin
        setInlineCoords({ lat:e.latlng.lat, lng:e.latlng.lng })
      })
      inlineLMapRef.current = map
    })
  }

  function confirmInlinePin() {
    if (!inlineCoords) return toast('Tap on map to place pin', 'err')
    setSv({ gps: { ...inlineCoords, acc:8 }, gpsAcc: 8 })
    setGpsState('locked')
    setShowInlineMap(false)
    toast('📍 Location set from map', 'ok')
  }

  function acceptManual() {
    const lat = parseFloat(manLat), lng = parseFloat(manLng)
    if (isNaN(lat)||isNaN(lng)) return toast('Enter valid coordinates', 'err')
    if (lat<6||lat>38||lng<68||lng>98) return toast('Coordinates outside India', 'err')
    setSv({ gps: { lat, lng, acc:15 }, gpsAcc: 15 }); setGpsState('locked')
    setShowManual(false)
    toast('📍 Manual coordinates set', 'ok')
  }

  // setField is now defined above as part of persistent session

  async function save() {
    if (!gps) return toast('Capture GPS first', 'err')
    if (!assetType) return toast('Select asset type', 'err')
    const fDefs = ASSET_FIELDS[assetType] || []
    const req = fDefs.find(f=>f.required && !fields[f.id])
    if (req) return toast(`${req.label} is required`, 'err')

    // ── Nearby check (20m radius) ────────────────────────────
    try {
      const nearby = await nearbyApi.query(gps.lat, gps.lng, 20)
      if (nearby.length > 0) {
        setNearbyModal({ nearby, pendingPayload: { gps, assetType, feederId, fields } })
        return  // pause — wait for user decision in modal
      }
    } catch(e) { console.warn('Nearby check failed:', e) }

    await doSave(gps, assetType, feederId, fields, [])
  }

  async function doSave(gpsCoords, type, fdr, flds, replaceIds = []) {
    setSaving(true)
    try {
      // Delete replaced assets if resurveying
      for (const id of replaceIds) {
        await assetsApi.delete(id)
        remove(id)
      }
      const { outstanding_amount, last_payment_date, mobile: mobileNum, _remarks, ...detailsOnly } = flds
      const name = type==='meter'
        ? flds.k_number
        : type==='line'
          ? (flds.from_pole||'?') + '→' + (flds.to_pole||'?')
          : null
      const payload = {
        asset_type: type,
        name: name || (type.toUpperCase() + '-TMP'),
        latitude: gpsCoords.lat,
        longitude: gpsCoords.lng,
        survey_accuracy_m: gpsCoords.acc,
        feeder_id: fdr||null,
        surveyed_by_id: profile?.id,
        details: detailsOnly,
        remarks: _remarks || null,
        outstanding_amount: type==='meter' ? (parseFloat(outstanding_amount)||0) : 0,
        last_payment_date: type==='meter' ? (last_payment_date||null) : null,
        mobile: type==='meter' ? (mobileNum||null) : null,
      }
      let saved = await assetsApi.create(payload)
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
            ? `Resurveyed: ${saved.asset_code} replaced ${replaceIds.length} previous asset(s)`
            : `New asset surveyed: ${saved.asset_code} (${type})`,
          meta: { asset_id: saved.id, asset_code: saved.asset_code, asset_type: type,
            lat: gpsCoords.lat, lng: gpsCoords.lng, replaced_ids: replaceIds },
        })
      } catch(auditErr) { console.warn('Audit log failed (non-blocking):', auditErr) }
      toast('✅ ' + saved.asset_code + ' saved', 'ok')
      clearSession()
      setGpsState('standby'); setBestFix(null)
      setNearbyModal(null)
    } catch(err) {
      toast(err.message, 'err')
    } finally { setSaving(false) }
  }


  // All roles can survey assets

  const gpsCol = gps ? gpsColorClass(gpsAcc||99) : '#4e7090'

  // Nearby assets — new correct logic
  if (nearbyModal) {
    const { nearby, pendingPayload: pp } = nearbyModal
    return (
      <NearbyChoiceModal
        nearby={nearby}
        pendingPayload={pp}
        assets={assets}
        onCancel={() => setNearbyModal(null)}
        onProceed={(replaceIds) => { setNearbyModal(null); doSave(pp.gps, pp.assetType, pp.feederId, pp.fields, replaceIds) }}
        auditApi={auditApi}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="p-3 space-y-3">

        {/* Draft resume banner */}
        {hasDraft && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between">
            <div>
              <div className="text-amber-400 font-bold text-xs">📋 Draft Survey In Progress</div>
              <div className="text-[10px] text-mu mt-0.5">
                {assetType ? `Type: ${assetType.toUpperCase()}` : 'GPS captured'} · Tap Save to complete or Discard to start fresh
              </div>
            </div>
            <button onClick={() => { clearSession(); setGpsState('standby') }}
              className="px-3 py-1.5 rounded-xl border border-red-500/30 text-red-400 text-[10px] font-bold flex-shrink-0">
              🗑 Discard
            </button>
          </div>
        )}

      {/* GPS Card */}
        <div className="bg-sf border border-bd rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-a font-rajdhani font-bold text-xs tracking-widest">📡 LOCATION</div>
            <div className="flex items-center gap-1.5 text-[10px]" style={{color:gpsCol}}>
              <div className={`w-1.5 h-1.5 rounded-full ${gpsState==='acquiring'?'animate-pulse':''}`}
                style={{background:gpsCol}} />
              {gpsState.toUpperCase()}
            </div>
          </div>

          {/* Coordinate display */}
          {gps ? (
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 bg-bg rounded-xl px-3 py-2 font-mono text-xs">
                <div className="text-mu text-[9px]">LAT</div>
                <div className="text-tx">{gps.lat.toFixed(6)}°</div>
              </div>
              <div className="flex-1 bg-bg rounded-xl px-3 py-2 font-mono text-xs">
                <div className="text-mu text-[9px]">LNG</div>
                <div className="text-tx">{gps.lng.toFixed(6)}°</div>
              </div>
              <div className="text-xs font-bold font-mono" style={{color:gpsCol}}>±{Math.round(gpsAcc||0)}m</div>
            </div>
          ) : (
            <div className="bg-bg rounded-xl px-4 py-3 text-center text-mu text-xs mb-3">
              {gpsState==='acquiring' ? (
                <div>
                  <div className="animate-pulse mb-1">📡 Acquiring GPS…</div>
                  {bestFix && (
                    <div>
                      <div className="text-[10px] mb-1.5">Best so far: ±{Math.round(bestFix.acc)}m</div>
                      <div className="h-1.5 bg-bd rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{width:`${Math.min(100,Math.round(GPS_OK/Math.max(bestFix.acc,1)*100))}%`,
                          background:gpsColorClass(bestFix.acc)}} />
                      </div>
                      <button onClick={()=>lockGPS(bestFix)}
                        className="mt-2 text-[10px] px-3 py-1 rounded-lg border border-a/50 text-a">
                        🔒 Lock Best Fix (±{Math.round(bestFix.acc)}m)
                      </button>
                    </div>
                  )}
                </div>
              ) : gpsState==='blocked' ? (
                <div className="text-amber-400 text-[10px]">📵 GPS blocked — use Map Pin or Manual below</div>
              ) : (
                <div className="text-[10px]">Tap "Get Location" to set asset position</div>
              )}
            </div>
          )}

          {/* 3 buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={startGPS}
              className="py-2.5 rounded-xl bg-gradient-to-br from-a/20 to-blue-500/20 border border-a/30 text-a text-[11px] font-bold font-rajdhani">
              📍 GPS
            </button>
            <button onClick={openInlineMap}
              className="py-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-400 text-[11px] font-bold font-rajdhani">
              🗺️ Map Pin
            </button>
            <button onClick={()=>setShowManual(m=>!m)}
              className="py-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-700/20 border border-purple-500/30 text-purple-400 text-[11px] font-bold font-rajdhani">
              ✏️ Manual
            </button>
          </div>

          {/* Manual entry */}
          {showManual && (
            <div className="mt-3 bg-bg rounded-xl p-3 border border-bd">
              <div className="text-[10px] text-mu mb-2">Enter coordinates from Google Maps</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input type="number" placeholder="Lat: 24.5963" step="0.000001"
                  className="bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none focus:border-a"
                  value={manLat} onChange={e=>setManLat(e.target.value)} />
                <input type="number" placeholder="Lng: 76.1690" step="0.000001"
                  className="bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none focus:border-a"
                  value={manLng} onChange={e=>setManLng(e.target.value)} />
              </div>
              <button onClick={acceptManual}
                className="w-full py-2 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-bold">
                ✅ Use These Coordinates
              </button>
            </div>
          )}

          {/* Inline Map Picker */}
          {showInlineMap && (
            <div className="mt-3 rounded-xl overflow-hidden border-2 border-a/50">
              <div className="bg-sf px-3 py-2 flex items-center justify-between">
                <div className="text-a text-[11px] font-bold font-rajdhani">📌 TAP MAP TO PIN LOCATION</div>
                <div className="flex gap-2">
                  <button onClick={confirmInlinePin} disabled={!inlineCoords}
                    className="px-3 py-1 rounded-lg bg-a text-bg text-[10px] font-bold disabled:opacity-40">
                    ✅ Confirm
                  </button>
                  <button onClick={()=>setShowInlineMap(false)}
                    className="px-2 py-1 rounded-lg border border-bd text-mu text-[10px]">✕</button>
                </div>
              </div>
              <div ref={inlineMapRef} style={{height:'260px'}} />
              <div className="bg-bg px-3 py-2 font-mono text-[10px] text-mu">
                {inlineCoords ? `📌 ${inlineCoords.lat.toFixed(6)}°N, ${inlineCoords.lng.toFixed(6)}°E · Drag pin to adjust` : 'Tap on map to drop pin'}
              </div>
            </div>
          )}
        </div>

        {/* Asset Type Grid */}
        <div className="bg-sf border border-bd rounded-2xl p-4">
          <div className="text-a font-rajdhani font-bold text-xs tracking-widest mb-3">🏗️ ASSET TYPE</div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ASSET_TYPES).map(([type, cfg]) => (
              <button key={type} onClick={()=>{ setAssetType(type) }}  /* setAssetType clears fields */
                className={`py-3 px-2 rounded-xl border transition-all flex flex-col items-center gap-1
                  ${assetType===type ? 'border-a bg-a/10 text-a' : 'border-bd bg-bg text-mu hover:border-bd2'}`}>
                <span className="text-xl">{cfg.icon}</span>
                <span className="text-[10px] font-bold font-rajdhani">{cfg.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Feeder select */}
        <div className="bg-sf border border-bd rounded-2xl p-4">
          <div className="text-a font-rajdhani font-bold text-xs tracking-widest mb-2">⚡ FEEDER</div>
          <select className="w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
            value={feederId} onChange={e=>setFeederId(e.target.value)}>
            <option value="">Select feeder…</option>
            {feeders.map(f => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
          </select>
        </div>

        {/* Asset-type specific fields */}
        {assetType && (
          <div className="bg-sf border border-bd rounded-2xl p-4">
            <div className="text-a font-rajdhani font-bold text-xs tracking-widest mb-3 flex items-center gap-2">
              <span>{ASSET_TYPES[assetType].icon}</span>
              <span>{ASSET_TYPES[assetType].label.toUpperCase()}</span>
            </div>
            <div className="space-y-3">
              {(ASSET_FIELDS[assetType]||[]).map(f => (
                <div key={f.id}>
                  <label className="text-[10px] text-mu font-bold tracking-widest uppercase block mb-1">
                    {f.label}{f.required?' *':''}
                  </label>
                  {f.type==='select' ? (
                    <select className="w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
                      value={fields[f.id]||''} onChange={e=>setField(f.id,e.target.value)}>
                      <option value="">Select…</option>
                      {f.options.map(o=><option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type||'text'}
                      className="w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
                      placeholder={f.placeholder}
                      value={fields[f.id]||''}
                      onChange={e=>setField(f.id,e.target.value)} />
                  )}
                </div>
              ))}
              <div>
                <label className="text-[10px] text-mu font-bold tracking-widest uppercase block mb-1">Remarks</label>
                <textarea className="w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
                  rows={2} placeholder="Any additional observations…"
                  value={fields['_remarks']||''} onChange={e=>setField('_remarks',e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <button onClick={save} disabled={saving||!gps||!assetType}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-base tracking-widest disabled:opacity-40 transition-opacity">
          {saving ? '⏳ Saving…' : '✅ Save to GeoMap'}
        </button>
      </div>
    </div>
  )
}
