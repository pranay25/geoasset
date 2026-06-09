import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAssetStore, useFeederStore, useWOStore, useAuthStore } from '../../store/index.js'
import { ASSET_TYPES, fmtOut, outColor } from '../../utils/constants.js'

export default function MobileMapPage() {
  const mapRef = useRef(null)
  const lmapRef = useRef(null)
  const leafletRef = useRef(null)
  const markersRef = useRef({})
  const navigate = useNavigate()

  const { assets, fetch: fetchAssets } = useAssetStore()
  const { feeders, fetch: fetchFeeders } = useFeederStore()
  const { wos, fetch: fetchWOs } = useWOStore()
  const { org, profile } = useAuthStore()

  const [selected, setSelected] = useState(null)
  const [locating, setLocating] = useState(false)
  const [activeFeeder, setActiveFeeder] = useState('all')

  useEffect(() => {
    fetchAssets(); fetchFeeders(); fetchWOs()
  }, [])

  useEffect(() => {
    if (!mapRef.current || lmapRef.current) return
    import('leaflet').then(L => {
      leafletRef.current = L
      const map = L.map(mapRef.current, {
        center: [org?.lat || 24.5963, org?.lng || 76.169],
        zoom: 15, zoomControl: false, tap: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 21
      }).addTo(map)
      lmapRef.current = map
    })
  }, [org])

  useEffect(() => {
    if (!lmapRef.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = lmapRef.current

    Object.values(markersRef.current).forEach(m => map.removeLayer(m))
    markersRef.current = {}

    assets.forEach(a => {
      if (a.asset_type === 'line') return
      if (activeFeeder !== 'all' && a.feeder_id !== activeFeeder) return
      const lat = parseFloat(a.latitude), lng = parseFloat(a.longitude)
      if (!lat || !lng) return

      const out = a.asset_type === 'meter' ? (a.outstanding_amount || 0) : 0
      const cfg = ASSET_TYPES[a.asset_type]
      let color = cfg?.color || '#888'
      let size = 14
      if (out >= 100000) { color = '#dc2626'; size = 22 }
      else if (out >= 50000) { color = '#ea580c'; size = 18 }
      else if (out >= 10000) { color = '#d97706'; size = 16 }
      if (a.status === 'flag' || a.status === 'fault') color = '#f59e0b'

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;background:${color};border:2.5px solid rgba(255,255,255,.4);border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:${size*.5}px">${out>=10000?'₹':cfg?.icon}</div>`,
        iconSize: [size, size], iconAnchor: [size/2, size/2]
      })

      const m = L.marker([lat, lng], { icon })
      m.on('click', () => setSelected(a))
      m.addTo(map)
      markersRef.current[a.id] = m
    })
  }, [assets, activeFeeder, wos])

  function locateMe() {
    if (!navigator.geolocation || !lmapRef.current) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => {
        lmapRef.current.flyTo([p.coords.latitude, p.coords.longitude], 18, { duration: 1 })
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const myWOs = wos.filter(w => w.status !== 'closed' &&
    (w.assigned_to_id === profile?.id || profile?.role === 'admin' || profile?.role === 'sdo'))

  return (
    <div className="relative h-full">
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Feeder chips */}
      <div className="absolute top-2 left-2 right-2 z-10 flex gap-2 overflow-x-auto">
        <button onClick={() => setActiveFeeder('all')}
          className={`flex-shrink-0 text-xs font-bold px-3 py-2 rounded-full border shadow-lg transition-colors
            ${activeFeeder==='all' ? 'bg-a text-bg border-a' : 'bg-bg/90 text-mu border-bd backdrop-blur'}`}>
          All
        </button>
        {feeders.map(f => (
          <button key={f.id} onClick={() => setActiveFeeder(f.id)}
            className={`flex-shrink-0 text-xs font-bold px-3 py-2 rounded-full border shadow-lg transition-colors
              ${activeFeeder===f.id ? 'bg-a text-bg border-a' : 'bg-bg/90 text-mu border-bd backdrop-blur'}`}>
            {f.code}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="absolute top-14 left-2 right-2 z-10 flex gap-2">
        {[
          { label: 'Assets', val: assets.length, color: '#00d4ff' },
          { label: 'Open WOs', val: myWOs.length, color: '#ef4444' },
          { label: 'Flagged', val: assets.filter(a=>a.status!=='ok').length, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-bg/90 backdrop-blur border border-bd rounded-xl py-2 text-center shadow-lg">
            <div className="font-mono text-sm font-bold" style={{ color: s.color }}>{s.val}</div>
            <div className="text-[9px] text-mu">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="absolute right-3 bottom-4 z-10 flex flex-col gap-3">
        {/* Locate me - large touch target */}
        <button onClick={locateMe}
          className="w-14 h-14 bg-sf/95 backdrop-blur border border-bd rounded-2xl flex items-center justify-center shadow-xl text-xl"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
          {locating ? <span className="animate-spin text-a">◌</span> : '📍'}
        </button>

        {/* Zoom in */}
        <button onClick={() => lmapRef.current?.zoomIn()}
          className="w-14 h-14 bg-sf/95 backdrop-blur border border-bd rounded-2xl flex items-center justify-center shadow-xl text-2xl font-bold text-tx">
          +
        </button>

        {/* Zoom out */}
        <button onClick={() => lmapRef.current?.zoomOut()}
          className="w-14 h-14 bg-sf/95 backdrop-blur border border-bd rounded-2xl flex items-center justify-center shadow-xl text-2xl font-bold text-tx">
          −
        </button>
      </div>

      {/* Quick survey FAB */}
      <button onClick={() => navigate('/m/survey')}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-6 py-4 rounded-2xl shadow-2xl font-rajdhani font-bold text-base"
        style={{ background: 'linear-gradient(135deg, #00d4ff, #3b82f6)', color: '#07101e', boxShadow: '0 4px 24px rgba(0,212,255,.4)' }}>
        📡 SURVEY
      </button>

      {/* Asset popup */}
      {selected && (
        <div className="absolute bottom-24 left-3 right-3 z-20 bg-sf border border-bd rounded-2xl p-4 shadow-2xl"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                style={{ background: ASSET_TYPES[selected.asset_type]?.bg }}>
                {ASSET_TYPES[selected.asset_type]?.icon}
              </div>
              <div>
                <div className="font-bold text-base">{selected.name}</div>
                <div className="text-xs text-mu">{selected.asset_code} · {ASSET_TYPES[selected.asset_type]?.label}</div>
                {selected.details?.consumer_name && (
                  <div className="text-xs text-mu mt-0.5">{selected.details.consumer_name}</div>
                )}
              </div>
            </div>
            <button onClick={() => setSelected(null)}
              className="w-8 h-8 rounded-xl bg-bg border border-bd flex items-center justify-center text-mu text-sm">
              ✕
            </button>
          </div>

          {(selected.outstanding_amount || 0) > 0 && (
            <div className="mb-3 px-3 py-2 rounded-xl border font-mono font-bold text-sm"
              style={{ background: outColor(selected.outstanding_amount) + '22', borderColor: outColor(selected.outstanding_amount) + '44', color: outColor(selected.outstanding_amount) }}>
              ₹{(selected.outstanding_amount).toLocaleString('en-IN')} outstanding
            </div>
          )}

          <div className="flex gap-2">
            <a href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
              target="_blank" rel="noreferrer"
              className="flex-1 py-3 rounded-xl border border-bd bg-bg text-center text-sm font-bold text-mu">
              📍 Maps
            </a>
            {selected.mobile && (
              <a href={`tel:${selected.mobile}`}
                className="flex-1 py-3 rounded-xl border border-green-500/30 bg-green-500/10 text-center text-sm font-bold text-green-400">
                📞 Call
              </a>
            )}
            <button onClick={() => { navigate('/m/assets', { state: { openId: selected.id } }); setSelected(null) }}
              className="flex-1 py-3 rounded-xl bg-a/10 border border-a/30 text-center text-sm font-bold text-a">
              Details
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
