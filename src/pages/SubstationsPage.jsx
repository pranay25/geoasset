import { useEffect, useState, useRef } from 'react'
import { useSubstationStore, useAuthStore, useUIStore } from '../store/index.js'
import { substationsApi } from '../api/client.js'

export default function SubstationsPage() {
  const { substations, fetch, add, update, remove } = useSubstationStore()
  const { org } = useAuthStore()
  const { toast } = useUIStore()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  // GPS survey state for substation
  const [gpsModal, setGpsModal] = useState(null)  // substation id being surveyed
  const [gps, setGPS] = useState(null)
  const [gpsAcc, setGpsAcc] = useState(null)
  const [gpsState, setGpsState] = useState('idle')
  const [bestFix, setBestFix] = useState(null)
  const watchRef = useRef(null)

  function startGPS(substationId) {
    setGpsModal(substationId)
    setGPS(null); setGpsAcc(null); setBestFix(null)
    setGpsState('acquiring')
    if (!navigator.geolocation) { setGpsState('failed'); return }
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        setBestFix(b => (!b || acc < b.acc) ? { lat, lng, acc } : b)
        setGpsAcc(acc)
        if (acc <= 5) lockGPS({ lat, lng, acc })
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 }
    )
    setTimeout(() => {
      if (watchRef.current) {
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
        setBestFix(b => { if (b) lockGPS(b); else setGpsState('failed'); return b })
      }
    }, 15000)
  }

  function lockGPS(fix) {
    if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    setGPS(fix); setGpsAcc(fix.acc); setGpsState('locked')
  }

  async function saveGPS() {
    if (!gps || !gpsModal) return
    try {
      const s = await substationsApi.update(gpsModal, {
        latitude: gps.lat, longitude: gps.lng, survey_accuracy_m: gps.acc
      })
      update(gpsModal, s)
      toast(`📍 GPS saved ±${Math.round(gps.acc)}m`, 'ok')
      setGpsModal(null); setGpsState('idle'); setGPS(null)
    } catch(e) { toast(e.message, 'err') }
  }

  useEffect(() => { fetch() }, [])

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  function openNew() {
    setForm({
      _new: true, name: '', voltage_ratio: '33/11kV', capacity_mva: '',
      num_feeders: '', num_consumers: '', present_load_mva: '',
      switchgear_type: '', num_vcb: '', num_pcb: '',
      village: '', tehsil: '', jen_office: '', district: '',
      latitude: '', longitude: '', remarks: '',
    })
  }

  function openEdit(s) {
    setForm({ ...s })
  }

  async function save() {
    if (!form.name) return toast('Substation name required', 'err')
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        voltage_ratio: form.voltage_ratio,
        capacity_mva: parseFloat(form.capacity_mva) || null,
        num_feeders: parseInt(form.num_feeders) || 0,
        num_consumers: parseInt(form.num_consumers) || 0,
        present_load_mva: parseFloat(form.present_load_mva) || null,
        switchgear_type: form.switchgear_type || null,
        num_vcb: parseInt(form.num_vcb) || 0,
        num_pcb: parseInt(form.num_pcb) || 0,
        village: form.village || null,
        tehsil: form.tehsil || null,
        jen_office: form.jen_office || null,
        district: form.district || null,
        latitude: parseFloat(form.latitude) || null,
        longitude: parseFloat(form.longitude) || null,
        remarks: form.remarks || null,
      }
      if (form._new) {
        const s = await substationsApi.create(payload)
        add(s); toast('✅ Substation created', 'ok')
      } else {
        const s = await substationsApi.update(form.id, payload)
        update(form.id, s); toast('✅ Substation updated', 'ok')
      }
      setForm(null)
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function del(s) {
    if (!confirm(`Delete ${s.name}?`)) return
    try { await substationsApi.delete(s.id); remove(s.id); toast('🗑 Deleted', 'ok') }
    catch(e) { toast(e.message, 'err') }
  }

  const VOLTAGE_OPTIONS = ['33/11kV','132/33kV','132/11kV','220/33kV','220/11kV','11/0.4kV']
  const SWITCHGEAR_OPTIONS = ['Indoor','Outdoor','GIS','Hybrid']

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 flex-shrink-0 flex items-center justify-between border-b border-bd">
        <div>
          <div className="font-rajdhani font-bold text-sm text-tx">🏭 Sub-Stations</div>
          <div className="text-[10px] text-mu mt-0.5">{org?.circle} · {substations.length} substations</div>
        </div>
        <button onClick={openNew}
          className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
          + New Substation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {substations.length === 0 && (
          <div className="text-center py-16 text-mu">
            <div className="text-5xl mb-3">🏭</div>
            <div className="text-sm">No substations yet</div>
            <div className="text-xs mt-1">Add substations — feeders will link to them</div>
          </div>
        )}

        {substations.map(s => {
          const load = s.present_load_mva && s.capacity_mva
            ? Math.round((s.present_load_mva / s.capacity_mva) * 100) : null
          const loadColor = load ? (load > 85 ? '#ef4444' : load > 70 ? '#f59e0b' : '#10b981') : '#4e7090'
          return (
            <div key={s.id} className="bg-sf border border-bd rounded-2xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-a text-xs font-bold">{s.code}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full border border-a/30 bg-a/10 text-a">{s.voltage_ratio}</span>
                  </div>
                  <div className="font-bold text-base mt-0.5">🏭 {s.name}</div>
                  <div className="text-[10px] text-mu mt-1 flex gap-3 flex-wrap">
                    {s.capacity_mva && <span>⚡ {s.capacity_mva} MVA</span>}
                    {s.village && <span>📍 {s.village}</span>}
                    {s.tehsil && <span>{s.tehsil}</span>}
                    {s.district && <span>{s.district}</span>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(s)}
                    className="w-8 h-8 rounded-lg border border-bd text-mu text-xs flex items-center justify-center hover:border-a hover:text-a">✏️</button>
                  <button onClick={() => del(s)}
                    className="w-8 h-8 rounded-lg border border-red-500/30 text-red-400 text-xs flex items-center justify-center">🗑</button>
                </div>
              </div>

              {/* Load bar */}
              {load !== null && (
                <div className="mb-3">
                  <div className="flex justify-between text-[9px] mb-1">
                    <span className="text-mu">Load</span>
                    <span className="font-mono font-bold" style={{ color: loadColor }}>
                      {s.present_load_mva} / {s.capacity_mva} MVA ({load}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(load, 100)}%`, background: loadColor }} />
                  </div>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  ['⚡', s.num_feeders || 0, 'Feeders'],
                  ['👥', (s.num_consumers || 0).toLocaleString('en-IN'), 'Consumers'],
                  ['🔌', s.num_vcb || 0, 'VCBs'],
                  ['📦', s.num_pcb || 0, 'PCBs'],
                ].map(([ic, n, l]) => (
                  <div key={l} className="bg-bg rounded-xl p-2 text-center">
                    <div className="text-sm">{ic}</div>
                    <div className="font-mono font-bold text-xs text-tx">{n}</div>
                    <div className="text-[9px] text-mu">{l}</div>
                  </div>
                ))}
              </div>

              {/* Extra info */}
              {(s.switchgear_type || s.jen_office) && (
                <div className="mt-2 text-[10px] text-mu flex gap-3">
                  {s.switchgear_type && <span>🔧 {s.switchgear_type}</span>}
                  {s.jen_office && <span>🏢 {s.jen_office}</span>}
                </div>
              )}

              <div className="flex gap-2 mt-3">
                <button onClick={() => startGPS(s.id)}
                  className="flex-1 py-2 rounded-xl border border-a/30 bg-a/10 text-a text-xs font-bold">
                  {s.latitude ? '📍 Re-Survey GPS' : '📍 Survey GPS Location'}
                </button>
              </div>
              {s.latitude && s.longitude && (
                <div className="mt-2 font-mono text-[10px] text-a/80 flex items-center gap-2">
                  <span>📍 {parseFloat(s.latitude).toFixed(5)}°N · {parseFloat(s.longitude).toFixed(5)}°E</span>
                  {s.survey_accuracy_m && <span className="text-mu">±{Math.round(s.survey_accuracy_m)}m</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* GPS Survey Modal */}
      {gpsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-sf border-2 border-a/40 rounded-3xl p-6 text-center">
            <div className="text-5xl mb-4">
              {gpsState==='locked' ? '✅' : gpsState==='failed' ? '❌' : '📡'}
            </div>
            <div className="font-rajdhani font-bold text-xl text-a mb-1">
              {gpsState==='locked' ? 'GPS Locked!' : gpsState==='failed' ? 'GPS Failed' : 'Acquiring GPS…'}
            </div>
            <div className="text-mu text-sm mb-4">
              {substations.find(s=>s.id===gpsModal)?.name}
            </div>

            {gpsState === 'acquiring' && (
              <div className="mb-4">
                <div className="text-mu text-xs animate-pulse mb-2">Stand at the substation location</div>
                {bestFix && (
                  <div>
                    <div className="font-mono text-sm text-a">±{Math.round(bestFix.acc)}m</div>
                    <div className="h-2 bg-bg rounded-full overflow-hidden mt-2">
                      <div className="h-full rounded-full transition-all bg-amber-400"
                        style={{width:`${Math.min(100,Math.round(25/Math.max(bestFix.acc,1)*100))}%`}} />
                    </div>
                    <button onClick={() => lockGPS(bestFix)}
                      className="mt-3 w-full py-2 rounded-xl border border-a/40 text-a text-sm font-bold">
                      🔒 Lock Best Fix (±{Math.round(bestFix.acc)}m)
                    </button>
                  </div>
                )}
              </div>
            )}

            {gpsState === 'locked' && gps && (
              <div className="bg-bg rounded-2xl p-4 mb-4 font-mono text-sm">
                <div className="text-a">{gps.lat.toFixed(6)}°N</div>
                <div className="text-a">{gps.lng.toFixed(6)}°E</div>
                <div className="text-green-400 text-xs mt-1">±{Math.round(gps.acc)}m accuracy</div>
              </div>
            )}

            {gpsState === 'failed' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-xs text-red-400">
                Could not get GPS. Move outside and try again.
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => {
                setGpsModal(null); setGpsState('idle'); setGPS(null)
                if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
              }} className="flex-1 py-3 rounded-2xl border border-bd text-mu font-bold">
                Cancel
              </button>
              {gpsState !== 'locked' && gpsState !== 'idle' ? (
                <button disabled className="flex-1 py-3 rounded-2xl bg-a/20 text-a/50 font-bold">
                  Waiting…
                </button>
              ) : gpsState === 'locked' ? (
                <button onClick={saveGPS}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold">
                  ✅ Save Location
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {form && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">
              {form._new ? '🏭 New Sub-Station' : '✏️ Edit Sub-Station'}
            </div>

            <div className="space-y-3">
              {/* Name + Voltage */}
              <div>
                <label className="text-[10px] text-mu block mb-1">Substation Name *</label>
                <input className={inp} placeholder="33/11 kV GSS Jhalawar"
                  value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Voltage Ratio</label>
                  <select className={inp} value={form.voltage_ratio || '33/11kV'}
                    onChange={e => setForm({...form, voltage_ratio: e.target.value})}>
                    {VOLTAGE_OPTIONS.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Capacity (MVA)</label>
                  <input type="number" className={inp} placeholder="10"
                    value={form.capacity_mva || ''} onChange={e => setForm({...form, capacity_mva: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Present Load (MVA)</label>
                  <input type="number" className={inp} placeholder="6.5"
                    value={form.present_load_mva || ''} onChange={e => setForm({...form, present_load_mva: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Switchgear Type</label>
                  <select className={inp} value={form.switchgear_type || ''}
                    onChange={e => setForm({...form, switchgear_type: e.target.value})}>
                    <option value="">Select…</option>
                    {SWITCHGEAR_OPTIONS.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">No. of Feeders</label>
                  <input type="number" className={inp} placeholder="8"
                    value={form.num_feeders || ''} onChange={e => setForm({...form, num_feeders: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">No. of Consumers</label>
                  <input type="number" className={inp} placeholder="5000"
                    value={form.num_consumers || ''} onChange={e => setForm({...form, num_consumers: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">No. of VCBs</label>
                  <input type="number" className={inp} placeholder="12"
                    value={form.num_vcb || ''} onChange={e => setForm({...form, num_vcb: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">No. of PCBs</label>
                  <input type="number" className={inp} placeholder="4"
                    value={form.num_pcb || ''} onChange={e => setForm({...form, num_pcb: e.target.value})} />
                </div>
              </div>

              {/* Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Village / Locality</label>
                  <input className={inp} placeholder="Jhalawar"
                    value={form.village || ''} onChange={e => setForm({...form, village: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Tehsil</label>
                  <input className={inp} placeholder="Jhalawar"
                    value={form.tehsil || ''} onChange={e => setForm({...form, tehsil: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">JEN Office</label>
                  <input className={inp} placeholder="JEN Office Jhalawar"
                    value={form.jen_office || ''} onChange={e => setForm({...form, jen_office: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">District</label>
                  <input className={inp} placeholder="Jhalawar"
                    value={form.district || ''} onChange={e => setForm({...form, district: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Latitude</label>
                  <input type="number" className={inp} placeholder="24.5963" step="0.0001"
                    value={form.latitude || ''} onChange={e => setForm({...form, latitude: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Longitude</label>
                  <input type="number" className={inp} placeholder="76.1690" step="0.0001"
                    value={form.longitude || ''} onChange={e => setForm({...form, longitude: e.target.value})} />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-mu block mb-1">Remarks</label>
                <textarea className={inp} rows={2}
                  value={form.remarks || ''} onChange={e => setForm({...form, remarks: e.target.value})} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={save} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving ? '⏳…' : '💾 Save Substation'}
                </button>
                <button onClick={() => setForm(null)}
                  className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
