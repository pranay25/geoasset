import { useEffect, useRef, useState } from 'react'
import { ASSET_TYPES, outColor, fmtOut } from '../../utils/constants.js'

export default function AssetMapPanel({ assets, org, onClose }) {
  const mapRef = useRef(null)
  const lmapRef = useRef(null)
  const leafletRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Stats for footer
  const stats = Object.entries(ASSET_TYPES).map(([type, cfg]) => ({
    type, cfg, count: assets.filter(a => a.asset_type === type).length
  })).filter(s => s.count > 0)

  const totalOut = assets.filter(a => a.asset_type === 'meter')
    .reduce((s, a) => s + (a.outstanding_amount || 0), 0)
  const flagged = assets.filter(a => a.status !== 'ok').length

  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      leafletRef.current = L
      if (lmapRef.current) { lmapRef.current.remove(); lmapRef.current = null }

      const pts = assets
        .filter(a => a.latitude && a.longitude)
        .map(a => [parseFloat(a.latitude), parseFloat(a.longitude)])

      const center = pts.length
        ? [pts.reduce((s,p) => s+p[0], 0) / pts.length, pts.reduce((s,p) => s+p[1], 0) / pts.length]
        : [org?.lat || 24.5963, org?.lng || 76.169]

      const map = L.map(mapRef.current, { center, zoom: 15, zoomControl: true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 21
      }).addTo(map)

      // Plot all selected assets
      assets.forEach((a, idx) => {
        if (!a.latitude || !a.longitude) return
        const cfg = ASSET_TYPES[a.asset_type]
        const out = a.outstanding_amount || 0
        let color = cfg?.color || '#888'
        let size = 14
        if (out >= 100000) { color = '#dc2626'; size = 20 }
        else if (out >= 50000) { color = '#ea580c'; size = 17 }
        else if (out >= 10000) { color = '#d97706'; size = 15 }
        if (a.status === 'flag' || a.status === 'fault') color = '#f59e0b'

        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:${size*.5}px;">${out>=10000?'₹':cfg?.icon}</div>`,
          iconSize: [size, size], iconAnchor: [size/2, size/2]
        })

        const labelIcon = L.divIcon({
          className: '',
          html: `<div style="background:rgba(7,16,30,0.92);color:#e2eaf4;font-size:8px;font-family:monospace;padding:3px 6px;border-radius:4px;border:1px solid rgba(0,212,255,0.4);white-space:nowrap;pointer-events:none;line-height:1.6;margin-top:12px;"><b style="color:#00d4ff">${a.name}</b><br><span style="color:#8eafc2">${parseFloat(a.latitude).toFixed(5)}&deg;N, ${parseFloat(a.longitude).toFixed(5)}&deg;E</span></div>`,
          iconSize: [0, 0], iconAnchor: [-4, -4]
        })

        const marker = L.marker([parseFloat(a.latitude), parseFloat(a.longitude)], { icon })
        marker.bindPopup(`
          <div style="font-family:sans-serif;min-width:160px;font-size:12px">
            <b>${cfg?.icon} ${a.name}</b><br>
            <span style="color:#999;font-size:10px">${cfg?.label} · ${a.asset_code || ''}</span>
            ${a.status !== 'ok' ? `<br><span style="color:#f59e0b;font-size:10px">⚠ ${a.flag_note || a.status}</span>` : ''}
            ${out > 0 ? `<br><span style="color:${outColor(out)};font-weight:bold">₹${out.toLocaleString('en-IN')}</span>` : ''}
            ${a.details?.consumer_name ? `<br>${a.details.consumer_name}` : ''}
            <br><span style="font-size:9px;font-family:monospace;color:#666">${parseFloat(a.latitude).toFixed(5)}°N, ${parseFloat(a.longitude).toFixed(5)}°E</span>
          </div>
        `)
        marker.addTo(map)
        L.marker([parseFloat(a.latitude), parseFloat(a.longitude)], { icon: labelIcon, interactive: false }).addTo(map)
      })

      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] })
      lmapRef.current = map
      setMapReady(true)
    })

    return () => {
      if (lmapRef.current) { lmapRef.current.remove(); lmapRef.current = null }
    }
  }, [])

  async function generatePDF() {
    setGenerating(true)
    try {
      const { jsPDF } = await import('jspdf').then(m => ({ jsPDF: m.jsPDF || m.default?.jsPDF || m.default }))
      const { default: html2canvas } = await import('html2canvas')

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const W = 297, H = 210, M = 10

      // ── Header ──
      doc.setFillColor(7,16,30)
      doc.rect(0, 0, W, 18, 'F')
      doc.setTextColor(0,212,255)
      doc.setFontSize(13); doc.setFont('helvetica','bold')
      doc.text(`${org?.name || 'GeoAsset'} — ${org?.division || ''}`, M, 8)
      doc.setFontSize(9); doc.setTextColor(200,220,240)
      doc.text('ASSET MAP DIAGRAM', M, 14)
      doc.setTextColor(160,180,200); doc.setFont('helvetica','normal'); doc.setFontSize(8)
      doc.text(`Generated: ${new Date().toLocaleString('en-IN')} · Total Assets: ${assets.length}`, W-M, 8, { align:'right' })
      doc.text(`Feeder: ${[...new Set(assets.map(a=>a.feeders?.code).filter(Boolean))].join(', ') || 'Multiple'}`, W-M, 14, { align:'right' })

      // ── Capture map as image ──
      const mapEl = mapRef.current
      if (mapEl && lmapRef.current) {
        lmapRef.current.invalidateSize()
        await new Promise(r => setTimeout(r, 500))  // let tiles load
        try {
          const canvas = await html2canvas(mapEl, {
            useCORS: true, allowTaint: true,
            width: mapEl.offsetWidth, height: mapEl.offsetHeight,
            backgroundColor: '#0c1626',
          })
          const imgData = canvas.toDataURL('image/jpeg', 0.9)
          // Map area: full width minus legend column, below header, above footer
          const mapX = M, mapY = 20
          const mapW = W - 65, mapH = H - mapY - 55
          doc.addImage(imgData, 'JPEG', mapX, mapY, mapW, mapH)
          doc.setDrawColor(28,53,80); doc.setLineWidth(0.3)
          doc.rect(mapX, mapY, mapW, mapH)
        } catch(e) { console.warn('Map capture failed:', e) }
      }

      // ── Legend (right column) ──
      const legX = W - 58, legY = 20
      doc.setFillColor(12,22,38); doc.rect(legX, legY, 55, H - legY - 55, 'F')
      doc.setDrawColor(28,53,80); doc.rect(legX, legY, 55, H - legY - 55)
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(0,212,255)
      doc.text('LEGEND', legX + 4, legY + 8)
      let ly = legY + 14

      // Asset type legend
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(180,200,220)
      doc.text('Asset Types', legX + 4, ly); ly += 5
      stats.forEach(({ type, cfg, count }) => {
        const [r, g, b] = hexToRgb(cfg.color)
        doc.setFillColor(r, g, b)
        doc.circle(legX + 7, ly - 1, 2, 'F')
        doc.setTextColor(200, 220, 240); doc.setFontSize(7)
        doc.text(`${cfg.label}`, legX + 11, ly)
        doc.setTextColor(0, 212, 255); doc.setFont('helvetica','bold')
        doc.text(`${count}`, legX + 50, ly, { align: 'right' })
        doc.setFont('helvetica','normal')
        ly += 5.5
      })

      // Outstanding legend
      ly += 3
      doc.setTextColor(180,200,220); doc.setFontSize(7)
      doc.text('₹ Outstanding', legX + 4, ly); ly += 5
      ;[[220,38,38,'≥₹1L'],[234,88,12,'≥₹50K'],[217,119,6,'≥₹10K']].forEach(([r,g,b,label]) => {
        doc.setFillColor(r,g,b); doc.circle(legX+7, ly-1, 2, 'F')
        doc.setTextColor(200,220,240); doc.setFontSize(7)
        doc.text(label, legX+11, ly); ly += 5
      })

      // Status legend
      ly += 3
      doc.setTextColor(180,200,220)
      doc.text('Status', legX + 4, ly); ly += 5
      ;[[245,158,11,'⚠ Flagged'],[16,185,129,'✓ OK']].forEach(([r,g,b,label]) => {
        doc.setFillColor(r,g,b); doc.circle(legX+7, ly-1, 2, 'F')
        doc.setTextColor(200,220,240); doc.setFontSize(7)
        doc.text(label, legX+11, ly); ly += 5
      })

      // ── Footer ──
      const footY = H - 48
      doc.setFillColor(7,16,30); doc.rect(0, footY, W, 48, 'F')
      doc.setDrawColor(0,212,255); doc.setLineWidth(0.3)
      doc.line(0, footY, W, footY)

      // Footer title
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(0,212,255)
      doc.text('ASSET SUMMARY', M, footY + 7)

      // Summary boxes
      const totalTypes = stats.length
      const boxW = Math.min(35, (W - 2*M - 60) / Math.max(totalTypes + 2, 1))
      let bx = M

      // Total box
      drawSummaryBox(doc, bx, footY + 10, boxW, '🏗️ Total', String(assets.length), [0,212,255])
      bx += boxW + 3

      // Per type boxes
      stats.forEach(({ cfg, count }) => {
        const [r,g,b] = hexToRgb(cfg.color)
        drawSummaryBox(doc, bx, footY + 10, boxW, cfg.icon + ' ' + cfg.label.split(' ')[0], String(count), [r,g,b])
        bx += boxW + 3
      })

      // Flagged box
      drawSummaryBox(doc, bx, footY + 10, boxW, '🚩 Flagged', String(flagged), [245,158,11])
      bx += boxW + 3

      // Outstanding box
      if (totalOut > 0) {
        drawSummaryBox(doc, bx, footY + 10, boxW, '₹ Outstanding', fmtOut(totalOut) || '0', [220,38,38])
      }

      // Coordinate range
      const lats = assets.filter(a=>a.latitude).map(a=>parseFloat(a.latitude))
      const lngs = assets.filter(a=>a.longitude).map(a=>parseFloat(a.longitude))
      if (lats.length) {
        doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(100,130,160)
        const coordText = `Lat: ${Math.min(...lats).toFixed(4)}–${Math.max(...lats).toFixed(4)}°N  Lng: ${Math.min(...lngs).toFixed(4)}–${Math.max(...lngs).toFixed(4)}°E`
        doc.text(coordText, W - M, footY + 42, { align: 'right' })
      }

      // Footer credits
      doc.setFontSize(6); doc.setTextColor(60,90,120)
      doc.text(`GeoAsset · ${org?.name} · ${org?.division} · ${new Date().toLocaleDateString('en-IN')}`, M, footY + 42)

      doc.save(`AssetMap_${new Date().toISOString().slice(0,10)}_${assets.length}assets.pdf`)
    } catch(e) {
      console.error('PDF error:', e)
    } finally { setGenerating(false) }
  }

  function drawSummaryBox(doc, x, y, w, label, value, [r,g,b]) {
    doc.setFillColor(r*0.15,g*0.15,b*0.15)
    doc.roundedRect(x, y, w, 28, 2, 2, 'F')
    doc.setDrawColor(r,g,b); doc.setLineWidth(0.4)
    doc.roundedRect(x, y, w, 28, 2, 2, 'S')
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(r,g,b)
    doc.text(label, x + w/2, y + 9, { align:'center', maxWidth: w-2 })
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(r,g,b)
    doc.text(value, x + w/2, y + 21, { align:'center' })
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
    return [r||0, g||0, b||0]
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-sf border-b border-bd flex-shrink-0">
        <button onClick={onClose} className="w-8 h-8 rounded-xl border border-bd flex items-center justify-center text-mu text-sm hover:text-tx">←</button>
        <div className="flex-1 min-w-0">
          <div className="font-rajdhani font-bold text-sm text-a">Asset Map — {assets.length} assets selected</div>
          <div className="text-[10px] text-mu truncate">
            {stats.map(s => `${s.cfg.icon} ${s.count} ${s.cfg.label}`).join(' · ')}
          </div>
        </div>
        <button onClick={generatePDF} disabled={generating || !mapReady}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-sm disabled:opacity-50">
          {generating ? '⏳' : '📄'} {generating ? 'Generating…' : 'Print PDF'}
        </button>
      </div>

      {/* Map */}
      <div ref={mapRef} className="flex-1" />

      {/* Footer stats bar */}
      <div className="bg-sf border-t border-bd px-4 py-2 flex-shrink-0 flex items-center gap-4 overflow-x-auto">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-mu">Total:</span>
          <span className="font-mono font-bold text-sm text-a">{assets.length}</span>
        </div>
        {stats.map(({ type, cfg, count }) => (
          <div key={type} className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-sm">{cfg.icon}</span>
            <span className="font-mono font-bold text-xs" style={{ color: cfg.color }}>{count}</span>
            <span className="text-[9px] text-mu">{cfg.label.split(' ')[0]}</span>
          </div>
        ))}
        {flagged > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs">🚩</span>
            <span className="font-mono font-bold text-xs text-amber-400">{flagged}</span>
            <span className="text-[9px] text-mu">Flagged</span>
          </div>
        )}
        {totalOut > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="font-mono font-bold text-xs text-red-400">{fmtOut(totalOut)}</span>
            <span className="text-[9px] text-mu">Outstanding</span>
          </div>
        )}
        <div className="ml-auto text-[9px] text-mu flex-shrink-0">
          PDF: A4 Landscape · Map + Legend + Summary
        </div>
      </div>
    </div>
  )
}
