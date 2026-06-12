import { useEffect, useRef, useState } from 'react'
import { useAssetStore, useFeederStore, useAuthStore } from '../store/index.js'
import { ASSET_TYPES } from '../utils/constants.js'

export default function ExportPage() {
  const { assets, fetch: fetchAssets } = useAssetStore()
  const { feeders, fetch: fetchFeeders } = useFeederStore()
  const { org } = useAuthStore()

  const [selectedFeeder, setSelectedFeeder] = useState('')
  const [exportFormat, setExportFormat] = useState('json')
  const [showMap, setShowMap] = useState(false)
  const mapRef = useRef(null)
  const lmapRef = useRef(null)
  const leafletRef = useRef(null)

  useEffect(() => { fetchAssets(); fetchFeeders() }, [])

  const feeder = feeders.find(f => f.id === selectedFeeder)
  const feederAssets = selectedFeeder
    ? assets.filter(a => a.feeder_id === selectedFeeder)
    : []

  // ── Export functions ──────────────────────────────────────

  function buildExportData() {
    return feederAssets.map(a => ({
      asset_code:         a.asset_code,
      asset_type:         a.asset_type,
      name:               a.name,
      latitude:           parseFloat(a.latitude),
      longitude:          parseFloat(a.longitude),
      survey_accuracy_m:  a.survey_accuracy_m,
      status:             a.status,
      feeder_code:        feeder?.code,
      feeder_name:        feeder?.name,
      survey_date:        a.survey_date,
      outstanding_amount: a.outstanding_amount || 0,
      mobile:             a.mobile || '',
      ...a.details,
    }))
  }

  function exportJSON() {
    const data = {
      _export:    'GeoAsset Feeder Export',
      org:        org?.name,
      division:   org?.division,
      feeder:     feeder?.code + ' — ' + feeder?.name,
      exported_at: new Date().toISOString(),
      asset_count: feederAssets.length,
      assets: buildExportData(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    download(blob, `${feeder?.code}_assets.json`)
  }

  function exportCSV() {
    const rows = buildExportData()
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const val = r[h] ?? ''
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      }).join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    download(blob, `${feeder?.code}_assets.csv`)
  }

  function exportKML() {
    const placemarks = feederAssets.map(a => {
      const cfg = ASSET_TYPES[a.asset_type]
      return `    <Placemark>
      <name>${a.name}</name>
      <description>${cfg?.label} | ${a.asset_code} | ${a.status}${a.outstanding_amount>0?' | Outstanding: Rs.'+a.outstanding_amount:''}</description>
      <Point><coordinates>${a.longitude},${a.latitude},0</coordinates></Point>
    </Placemark>`
    }).join('\n')

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${feeder?.code} — ${feeder?.name}</name>
    <description>${org?.name} ${org?.division} | Exported: ${new Date().toLocaleDateString('en-IN')}</description>
${placemarks}
  </Document>
</kml>`
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' })
    download(blob, `${feeder?.code}_assets.kml`)
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function doExport() {
    if (!selectedFeeder) return
    if (exportFormat === 'json') exportJSON()
    else if (exportFormat === 'csv') exportCSV()
    else exportKML()
  }

  // ── Map Diagram ───────────────────────────────────────────

  useEffect(() => {
    if (!showMap || !mapRef.current) return
    if (lmapRef.current) { lmapRef.current.remove(); lmapRef.current = null }

    import('leaflet').then(L => {
      leafletRef.current = L
      const pts = feederAssets
        .filter(a => a.latitude && a.longitude)
        .map(a => [parseFloat(a.latitude), parseFloat(a.longitude)])

      const center = pts.length
        ? [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length]
        : [org?.lat||24.5963, org?.lng||76.169]

      const map = L.map(mapRef.current, { center, zoom: 15, zoomControl: true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 21
      }).addTo(map)

      feederAssets.forEach(a => {
        if (!a.latitude || !a.longitude) return
        const cfg = ASSET_TYPES[a.asset_type]
        const lat = parseFloat(a.latitude), lng = parseFloat(a.longitude)

        // Marker
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:18px;height:18px;background:${cfg?.color};border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:9px;">${cfg?.icon}</div>`,
          iconSize: [18,18], iconAnchor: [9,9]
        })

        // Label
        const label = L.divIcon({
          className: '',
          html: `<div style="background:rgba(7,16,30,0.92);color:#e2eaf4;font-size:8px;font-family:monospace;padding:3px 6px;border-radius:4px;border:1px solid rgba(0,212,255,0.4);white-space:nowrap;margin-top:14px;line-height:1.6;"><b style="color:#00d4ff">${a.name}</b><br><span style="color:#8eafc2">${parseFloat(a.latitude).toFixed(5)}&deg;N, ${parseFloat(a.longitude).toFixed(5)}&deg;E</span></div>`,
          iconSize: [0,0], iconAnchor: [-2,-2]
        })

        L.marker([lat, lng], { icon }).addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:150px;">
              <b>${a.name}</b><br>
              <span style="font-size:11px;color:#999">${cfg?.label} · ${a.asset_code}</span><br>
              <span style="font-size:10px;font-family:monospace">${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E</span>
              ${a.status!=='ok'?'<br><span style="color:#f59e0b;font-size:11px">⚠ '+a.status+'</span>':''}
              ${(a.outstanding_amount||0)>0?'<br><span style="color:#ef4444;font-size:11px">₹'+a.outstanding_amount.toLocaleString('en-IN')+'</span>':''}
            </div>
          `)
        L.marker([lat, lng], { icon: label }).addTo(map)
      })

      // Draw line connections for line-type assets
      const lines = feederAssets.filter(a => a.asset_type === 'line')
      // Fit bounds
      if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] })
      }

      lmapRef.current = map
    })
  }, [showMap, feederAssets])

  function printMap() {
    window.print()
  }

  const stats = {
    total: feederAssets.length,
    poles: feederAssets.filter(a=>a.asset_type==='pole').length,
    dtrs: feederAssets.filter(a=>a.asset_type==='dtr').length,
    meters: feederAssets.filter(a=>a.asset_type==='meter').length,
    flagged: feederAssets.filter(a=>a.status!=='ok').length,
    outstanding: feederAssets.filter(a=>(a.outstanding_amount||0)>0).length,
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-0 flex-shrink-0 space-y-3">
        <div className="font-rajdhani font-bold text-sm text-tx">📤 Export & Map Diagram</div>

        {/* Feeder selector */}
        <div>
          <label className="text-[10px] text-mu block mb-1.5 tracking-widest uppercase">Select Feeder</label>
          <select
            className="w-full bg-sf border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"
            value={selectedFeeder}
            onChange={e => { setSelectedFeeder(e.target.value); setShowMap(false); if(lmapRef.current){lmapRef.current.remove();lmapRef.current=null} }}>
            <option value="">— Select a feeder —</option>
            {feeders.map(f => (
              <option key={f.id} value={f.id}>{f.code} — {f.name}</option>
            ))}
          </select>
        </div>

        {/* Stats */}
        {selectedFeeder && (
          <div className="grid grid-cols-3 gap-2">
            {[['🏗️',stats.total,'Total'],['🪧',stats.poles,'Poles'],['🔆',stats.dtrs,'DTRs'],
              ['🔌',stats.meters,'Meters'],['🚩',stats.flagged,'Flagged'],['₹',stats.outstanding,'Outstg']
            ].map(([ic,n,l]) => (
              <div key={l} className="bg-sf border border-bd rounded-xl p-2.5 text-center">
                <div className="text-base">{ic}</div>
                <div className="font-mono font-bold text-sm text-tx">{n}</div>
                <div className="text-[9px] text-mu">{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFeeder && (
        <div className="flex-1 overflow-y-auto p-4 pt-3 space-y-3">

          {/* Export options */}
          <div className="bg-sf border border-bd rounded-2xl p-4">
            <div className="font-rajdhani font-bold text-xs text-a tracking-wider mb-3">📁 EXPORT TAGGED ASSETS</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[['json','JSON'],['csv','CSV'],['kml','KML']].map(([fmt,label]) => (
                <button key={fmt} onClick={() => setExportFormat(fmt)}
                  className={`py-3 rounded-xl border-2 font-bold text-sm transition-all
                    ${exportFormat===fmt ? 'border-a bg-a/10 text-a' : 'border-bd text-mu'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-mu mb-3">
              {exportFormat==='json' && '• Full asset data with GPS, status, details — for importing into other systems'}
              {exportFormat==='csv' && '• Spreadsheet-ready — open in Excel or Google Sheets'}
              {exportFormat==='kml' && '• Google Earth / Google Maps compatible — view assets on any map app'}
            </div>
            <button onClick={doExport} disabled={!feederAssets.length}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-sm disabled:opacity-40">
              ⬇️ Download {feeder?.code} Assets ({feederAssets.length})
            </button>
          </div>

          {/* Map Diagram */}
          <div className="bg-sf border border-bd rounded-2xl overflow-hidden">
            <div className="p-4 flex items-center justify-between">
              <div>
                <div className="font-rajdhani font-bold text-xs text-a tracking-wider">🗺️ ASSET MAP DIAGRAM</div>
                <div className="text-[10px] text-mu mt-0.5">All {feederAssets.length} assets plotted with labels & coordinates</div>
              </div>
              <div className="flex gap-2">
                {showMap && (
                  <button onClick={printMap}
                    className="px-3 py-2 rounded-xl border border-bd text-mu text-xs font-bold">
                    🖨️ Print
                  </button>
                )}
                <button onClick={() => setShowMap(s => !s)}
                  className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
                  {showMap ? '✕ Close' : '🗺️ Open Map'}
                </button>
              </div>
            </div>

            {showMap && (
              <div>
                <div ref={mapRef} style={{ height: '420px' }} />

                {/* Asset list below map with coordinates */}
                <div className="p-4 border-t border-bd">
                  <div className="font-rajdhani font-bold text-xs text-mu tracking-wider mb-3">
                    ASSET COORDINATES — {feeder?.code} {feeder?.name}
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {feederAssets.map(a => {
                      const cfg = ASSET_TYPES[a.asset_type]
                      return (
                        <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-bd/40 text-xs">
                          <span className="text-base w-6 flex-shrink-0">{cfg?.icon}</span>
                          <span className="font-semibold w-24 flex-shrink-0 truncate">{a.name}</span>
                          <span className="text-mu text-[10px] flex-shrink-0 w-20">{cfg?.label}</span>
                          <span className="font-mono text-[10px] text-a flex-1">
                            {parseFloat(a.latitude).toFixed(5)}°N, {parseFloat(a.longitude).toFixed(5)}°E
                          </span>
                          {a.status !== 'ok' && <span className="text-amber-400 text-[9px]">⚠</span>}
                        </div>
                      )
                    })}
                  </div>

                  {/* Print button */}
                  <button onClick={() => {
                    const html = `
                      <html><head><title>${feeder?.code} Asset Map</title>
                      <style>body{font-family:sans-serif;padding:20px}h2{color:#1e3a5f}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left}td{padding:5px 8px;border-bottom:1px solid #eee}</style>
                      </head><body>
                      <h2>${org?.name} — ${org?.division}</h2>
                      <h3>Feeder: ${feeder?.code} — ${feeder?.name}</h3>
                      <p style="color:#666;font-size:11px">Generated: ${new Date().toLocaleString('en-IN')} | Total assets: ${feederAssets.length}</p>
                      <table>
                        <tr><th>#</th><th>Name</th><th>Type</th><th>Code</th><th>Latitude</th><th>Longitude</th><th>Status</th><th>Outstanding</th></tr>
                        ${feederAssets.map((a,i) => `
                          <tr>
                            <td>${i+1}</td>
                            <td>${a.name}</td>
                            <td>${ASSET_TYPES[a.asset_type]?.label}</td>
                            <td>${a.asset_code||''}</td>
                            <td>${parseFloat(a.latitude).toFixed(6)}</td>
                            <td>${parseFloat(a.longitude).toFixed(6)}</td>
                            <td>${a.status}</td>
                            <td>${(a.outstanding_amount||0)>0?'Rs.'+a.outstanding_amount.toLocaleString('en-IN'):''}</td>
                          </tr>`).join('')}
                      </table>
                      </body></html>`
                    const w = window.open('', '_blank')
                    w.document.write(html)
                    w.document.close()
                    w.print()
                  }}
                    className="w-full mt-3 py-3 rounded-xl border border-bd text-mu font-rajdhani font-bold text-sm hover:border-a hover:text-a transition-colors">
                    🖨️ Print Asset Coordinate Report
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedFeeder && (
        <div className="flex-1 flex items-center justify-center text-mu">
          <div className="text-center">
            <div className="text-5xl mb-4">📤</div>
            <div className="text-sm">Select a feeder to export or view map</div>
          </div>
        </div>
      )}
    </div>
  )
}
