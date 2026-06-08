import { useEffect, useRef, useState } from 'react'
import { useAssetStore, useFeederStore, useWOStore, useGroupStore, useAuthStore } from '../store/index.js'
import { ASSET_TYPES, fmtOut, outColor } from '../utils/constants.js'

export default function MapPage() {
  const mapRef = useRef(null)
  const lmapRef = useRef(null)
  const markersRef = useRef({})
  const groupLayersRef = useRef({})

  const { assets, fetch: fetchAssets } = useAssetStore()
  const { feeders, fetch: fetchFeeders } = useFeederStore()
  const { wos, fetch: fetchWOs } = useWOStore()
  const { groups } = useGroupStore()
  const { org } = useAuthStore()

  const [activeFeeder, setActiveFeeder] = useState('all')
  const [layers, setLayers] = useState({ pole:true,dtr:true,meter:true,line:true,pillar:true,iso:true })

  useEffect(() => {
    fetchAssets(); fetchFeeders(); fetchWOs()
  }, [])

  useEffect(() => {
    if (!mapRef.current || lmapRef.current) return
    import('leaflet').then(L => {
      const map = L.map(mapRef.current, {
        center: [org?.lat||24.5963, org?.lng||76.169],
        zoom: 15, zoomControl: false,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 21
      }).addTo(map)
      lmapRef.current = map
      renderMarkers(L, map)
    })
  }, [org])

  useEffect(() => {
    if (!lmapRef.current) return
    import('leaflet').then(L => renderMarkers(L, lmapRef.current))
  }, [assets, activeFeeder, layers])

  useEffect(() => {
    if (!lmapRef.current) return
    import('leaflet').then(L => renderGroups(L, lmapRef.current))
  }, [groups, assets])

  function markerIcon(L, a) {
    const out = a.asset_type==='meter' ? (a.outstanding_amount||0) : 0
    const hasWO = wos.some(w=>w.status!=='closed'&&(w.asset_ids||[]).includes(a.id))
    let color, size = 12
    if (hasWO||a.status==='fault')  color='#ef4444'
    else if (a.status==='flag')     color='#f59e0b'
    else if (out>=100000) { color='#dc2626'; size=20 }
    else if (out>=50000)  { color='#ea580c'; size=16 }
    else if (out>=10000)  { color='#d97706'; size=14 }
    else color = ASSET_TYPES[a.asset_type]?.color || '#888'
    const label = out>=10000 ? '₹' : (ASSET_TYPES[a.asset_type]?.icon||'•')
    return L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid rgba(255,255,255,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${size*.55}px;box-shadow:0 2px 6px rgba(0,0,0,.5);">${label}</div>`,
      iconSize: [size,size], iconAnchor: [size/2,size/2]
    })
  }

  function renderMarkers(L, map) {
    // Clear old markers
    Object.values(markersRef.current).forEach(m => map.removeLayer(m))
    markersRef.current = {}

    assets.forEach(a => {
      if (a.asset_type==='line') return
      if (!layers[a.asset_type]) return
      if (activeFeeder!=='all' && a.feeder_id!==activeFeeder) return

      const lat = parseFloat(a.latitude), lng = parseFloat(a.longitude)
      if (!lat||!lng) return

      const m = L.marker([lat,lng], { icon: markerIcon(L,a) })
      const out = a.outstanding_amount||0
      const type = ASSET_TYPES[a.asset_type]
      m.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px;">
          <div style="font-weight:700;margin-bottom:4px;">${type?.icon} ${a.name}</div>
          <div style="font-size:11px;color:#999;">${type?.label} · ${a.asset_code||''}</div>
          ${a.status!=='ok'?`<div style="font-size:11px;color:#f59e0b;margin-top:3px;">⚠ ${a.flag_note||a.status}</div>`:''}
          ${out>0?`<div style="font-size:12px;color:${outColor(out)};font-weight:700;margin-top:3px;">₹${out.toLocaleString('en-IN')}</div>`:''}
          ${a.details?.consumer_name?`<div style="font-size:11px;margin-top:2px;">${a.details.consumer_name}</div>`:''}
          ${a.mobile?`<div style="margin-top:6px;"><a href="tel:${a.mobile}" style="color:#10b981;font-size:11px;">📞 ${a.mobile}</a></div>`:''}
        </div>
      `)
      m.addTo(map)
      markersRef.current[a.id] = m
    })
  }

  function renderGroups(L, map) {
    Object.values(groupLayersRef.current).forEach(l => map.removeLayer(l))
    groupLayersRef.current = {}
    groups.forEach(g => {
      const layer = L.layerGroup()
      ;(g.meter_ids||[]).forEach(id => {
        const a = assets.find(x=>x.id===id)
        if (!a) return
        L.circleMarker([parseFloat(a.latitude),parseFloat(a.longitude)], {
          radius:12, color:g.color, fillColor:g.color, fillOpacity:0.25, weight:2
        }).addTo(layer)
      })
      layer.addTo(map)
      groupLayersRef.current[g.id] = layer
    })
  }

  function flyToFeeder(feederId) {
    setActiveFeeder(feederId)
    if (!lmapRef.current) return
    const pts = assets
      .filter(a=>a.feeder_id===feederId&&a.asset_type!=='line')
      .map(a=>[parseFloat(a.latitude),parseFloat(a.longitude)])
    if (pts.length>1) {
      import('leaflet').then(L => lmapRef.current.flyToBounds(L.latLngBounds(pts),{padding:[40,40]}))
    }
  }

  function locateMe() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(p => {
      lmapRef.current?.flyTo([p.coords.latitude,p.coords.longitude],17,{duration:1})
    })
  }

  const totalOut = useAssetStore(s=>s.totalOutstanding())
  const openWOs = wos.filter(w=>w.status!=='closed').length

  return (
    <div className="relative h-full">
      {/* Map container */}
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Stats bar */}
      <div className="absolute top-2 left-2 right-2 z-10 flex gap-1.5 overflow-x-auto">
        {[
          { label:'Assets', val:assets.length, color:'#00d4ff' },
          { label:'DTR',    val:assets.filter(a=>a.asset_type==='dtr').length, color:'#f59e0b' },
          { label:'Meters', val:assets.filter(a=>a.asset_type==='meter').length, color:'#10b981' },
          { label:'WOs',    val:openWOs, color:'#ef4444' },
          totalOut>0 ? { label:'₹Outstd', val:fmtOut(totalOut), color:'#f97316' } : null,
        ].filter(Boolean).map(s => (
          <div key={s.label} className="flex-shrink-0 bg-bg/90 backdrop-blur border border-bd rounded-lg px-2.5 py-1.5 text-center">
            <div className="font-mono text-xs font-bold" style={{color:s.color}}>{s.val}</div>
            <div className="text-[8px] text-mu">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Feeder filter chips */}
      <div className="absolute top-14 left-2 right-2 z-10 flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={()=>setActiveFeeder('all')}
          className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors
            ${activeFeeder==='all' ? 'bg-a text-bg border-a' : 'bg-bg/80 text-mu border-bd backdrop-blur'}`}>
          All
        </button>
        {feeders.map(f => (
          <button key={f.id} onClick={()=>flyToFeeder(f.id)}
            className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors
              ${activeFeeder===f.id ? 'bg-a text-bg border-a' : 'bg-bg/80 text-mu border-bd backdrop-blur'}`}>
            {f.code}
          </button>
        ))}
      </div>

      {/* Map controls */}
      <div className="absolute right-2 bottom-4 z-10 flex flex-col gap-2">
        <button onClick={locateMe}
          className="w-10 h-10 bg-sf/90 backdrop-blur border border-bd rounded-xl text-a text-base flex items-center justify-center shadow-lg hover:border-a transition-colors">
          📍
        </button>
        {/* Layer toggles */}
        {Object.entries(ASSET_TYPES).map(([type, cfg]) => (
          <button key={type} onClick={() => setLayers(l=>({...l,[type]:!l[type]}))}
            className={`w-10 h-10 bg-sf/90 backdrop-blur rounded-xl text-sm flex items-center justify-center border transition-all
              ${layers[type] ? 'border-bd' : 'border-bd opacity-30'}`}
            style={{ boxShadow: layers[type] ? `0 0 0 1px ${cfg.color}44` : 'none' }}
            title={cfg.label}>
            {cfg.icon}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-2 z-10 bg-bg/90 backdrop-blur border border-bd rounded-xl p-3 text-[9px]">
        <div className="text-a font-bold tracking-wider mb-2 text-[8px]">LEGEND</div>
        {Object.values(ASSET_TYPES).map(t => (
          <div key={t.label} className="flex items-center gap-1.5 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{background:t.color}} />
            <span className="text-mu">{t.label}</span>
          </div>
        ))}
        <div className="border-t border-bd mt-2 pt-2">
          <div className="text-a font-bold tracking-wider mb-1 text-[8px]">₹ OUTSTANDING</div>
          {[['#dc2626','≥₹1L'],['#ea580c','≥₹50K'],['#d97706','≥₹10K']].map(([c,l])=>(
            <div key={l} className="flex items-center gap-1.5 mb-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{background:c}} />
              <span className="text-mu">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
