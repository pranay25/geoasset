import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAssetStore, useFeederStore, useAuthStore, useUIStore } from '../../store/index.js'
import { assetsApi } from '../../api/client.js'
import { ASSET_TYPES, GPS_GOOD, GPS_OK, gpsColorClass } from '../../utils/constants.js'

const STEPS = ['gps', 'type', 'feeder', 'details', 'confirm']

const ASSET_FIELDS = {
  pole:   [{ id:'number', label:'Pole Number', placeholder:'P-0247', required:true, keyboard:'text' },
           { id:'pole_type', label:'Type', type:'select', options:['PCC','PSC','Wood','GI'] },
           { id:'height_m', label:'Height', type:'select', options:['7.5m','9m','11m','13m'] },
           { id:'line_type', label:'Line', type:'select', options:['LT Line','HT 11kV','HT 33kV'] }],
  dtr:    [{ id:'number', label:'DTR Number', placeholder:'DTR-0142', required:true },
           { id:'capacity_kva', label:'Capacity', type:'select', options:['25','63','100','160','200','250','315','400'] },
           { id:'present_load_pct', label:'Load %', type:'number', placeholder:'65' },
           { id:'consumers_count', label:'Consumers', type:'number', placeholder:'48' }],
  meter:  [{ id:'k_number', label:'K. Number', placeholder:'K-00123456', required:true },
           { id:'consumer_name', label:'Consumer Name', placeholder:'Ram Prasad' },
           { id:'category', label:'Category', type:'select', options:['DS','NS','AG','IP','LT_I','SL'] },
           { id:'mobile', label:'Mobile', placeholder:'9414511001', type:'tel' },
           { id:'outstanding_amount', label:'Outstanding ₹', type:'number', placeholder:'0' }],
  line:   [{ id:'from_pole', label:'From Pole', placeholder:'P-0247', required:true },
           { id:'to_pole', label:'To Pole', placeholder:'P-0248', required:true },
           { id:'line_type', label:'Type', type:'select', options:['LT Line','HT 11kV','HT 33kV'] }],
  pillar: [{ id:'unit_number', label:'Pillar No.', placeholder:'FP-012', required:true },
           { id:'rating_amps', label:'Rating (A)', type:'number', placeholder:'200' }],
  iso:    [{ id:'iso_number', label:'Isolator No.', placeholder:'ISO-0034', required:true },
           { id:'iso_type', label:'Type', type:'select', options:['ABS','DOF','Gang','RMU'] },
           { id:'voltage_level', label:'Voltage', type:'select', options:['HT 11kV','HT 33kV','LT'] }],
}

export default function MobileSurveyPage() {
  const navigate = useNavigate()
  const { assets, fetch: fetchAssets, add: addAsset } = useAssetStore()
  const { feeders } = useFeederStore()
  const { profile } = useAuthStore()
  const { toast } = useUIStore()

  const [step, setStep] = useState('gps')
  const [gps, setGPS] = useState(null)
  const [gpsAcc, setGpsAcc] = useState(null)
  const [bestFix, setBestFix] = useState(null)
  const [gpsState, setGpsState] = useState('idle') // idle|acquiring|locked|failed
  const [assetType, setAssetType] = useState(null)
  const [feederId, setFeederId] = useState('')
  const [fields, setFields] = useState({})
  const [saving, setSaving] = useState(false)
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
    setGPS(fix); setGpsAcc(fix.acc); setGpsState('locked')
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
    setGPS({ ...pickedCoords, acc: 10 }); setGpsAcc(10); setGpsState('locked')
    setShowMapPicker(false); lmapRef.current = null
    toast('📍 Location set','ok')
  }

  async function save() {
    if (!gps) return toast('Set GPS location first','err')
    if (!assetType) return toast('Select asset type','err')
    const fDefs = ASSET_FIELDS[assetType] || []
    const req = fDefs.find(f => f.required && !fields[f.id])
    if (req) return toast(req.label + ' is required','err')
    setSaving(true)
    try {
      const { outstanding_amount, last_payment_date, mobile: mob, ...detailsOnly } = fields
      const name = fields.number || fields.k_number || fields.unit_number || fields.iso_number || assetType.toUpperCase() + '-NEW'
      const saved = await assetsApi.create({
        asset_type: assetType, name,
        latitude: gps.lat, longitude: gps.lng, survey_accuracy_m: gps.acc,
        feeder_id: feederId || null, surveyed_by_id: profile?.id,
        details: detailsOnly,
        outstanding_amount: assetType==='meter' ? (parseFloat(outstanding_amount)||0) : 0,
        mobile: assetType==='meter' ? (mob||null) : null,
      })
      addAsset(saved)
      toast('✅ ' + saved.asset_code + ' saved','ok')
      // Reset
      setStep('gps'); setGPS(null); setGpsState('idle'); setBestFix(null)
      setAssetType(null); setFields({}); setFeederId('')
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  const gpsCol = gps ? gpsColorClass(gpsAcc||99) : '#4e7090'
  const inp = "w-full bg-bg border border-bd rounded-2xl px-4 py-4 text-base text-tx focus:outline-none focus:border-a transition-colors"

  // STEP: GPS
  if (step === 'gps') return (
    <div className="h-full flex flex-col p-4 gap-4">
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
                setGPS({ lat:parseFloat(lat), lng:parseFloat(lng), acc:15 })
                setGpsAcc(15); setGpsState('locked')
              }
            }} className="py-4 rounded-2xl border-2 border-purple-500/40 text-purple-400 font-bold text-sm">
              ✏️ Manual
            </button>
          </div>
        </div>
      </div>

      {gpsState === 'locked' && (
        <button onClick={() => setStep('type')}
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
          <button key={type} onClick={() => { setAssetType(type); setStep('feeder') }}
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
        <button onClick={() => { setFeederId(''); setStep('details') }}
          className={`w-full py-5 rounded-2xl border-2 font-bold text-base transition-all
            ${!feederId ? 'border-a text-a' : 'border-bd text-mu'}`}>
          No Feeder / Unknown
        </button>
        {feeders.map(f => (
          <button key={f.id} onClick={() => { setFeederId(f.id); setStep('details') }}
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
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pb-2">
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
