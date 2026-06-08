// ─── FeedersPage ─────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useFeederStore, useAssetStore, useAuthStore, useUIStore } from '../store/index.js'
import { feedersApi } from '../api/client.js'

export function FeedersPage() {
  const { feeders, fetch, add, update, remove } = useFeederStore()
  const { assets } = useAssetStore()
  const { org, canManageUsers } = useAuthStore()
  const { toast } = useUIStore()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetch() }, [])

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  function openNew() {
    setForm({ code:'', name:'', voltage_kv:11, sanctioned_load_kva:'', ht_length_km:'', lt_length_km:'', source_substation:'', remarks:'' })
  }
  function openEdit(f) { setForm({ ...f, _id: f.id }) }

  async function save() {
    if (!form.code||!form.name) return toast('Code and name required','err')
    setSaving(true)
    try {
      if (form._id) {
        const { _id, id, org_id, created_at, ...payload } = form
        const updated = await feedersApi.update(form._id, payload)
        update(form._id, updated)
        toast('✅ Feeder updated','ok')
      } else {
        const created = await feedersApi.create({ ...form, code: form.code.toUpperCase() })
        add(created)
        toast('✅ Feeder created','ok')
      }
      setForm(null)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function del(f) {
    const linked = assets.filter(a=>a.feeder_id===f.id).length
    if (linked>0) return toast(`Cannot delete — ${linked} assets linked`,'err')
    if (!confirm(`Delete ${f.code}?`)) return
    try { await feedersApi.delete(f.id); remove(f.id); toast('🗑 Deleted','ok') }
    catch(e) { toast(e.message,'err') }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-2 flex-shrink-0 flex items-center justify-between">
        <div className="font-rajdhani font-bold text-sm text-tx">Feeders</div>
        <button onClick={openNew} className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">+ New</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {feeders.map(f => {
          const fa = assets.filter(a=>a.feeder_id===f.id)
          const dtrs=fa.filter(a=>a.asset_type==='dtr'), poles=fa.filter(a=>a.asset_type==='pole'), meters=fa.filter(a=>a.asset_type==='meter')
          const load = dtrs.reduce((s,d)=>s+(d.details?.present_load_pct||0),0)/Math.max(dtrs.length,1)
          const loadColor = load>85?'#ef4444':load>70?'#f59e0b':'#10b981'
          return (
            <div key={f.id} className="bg-sf border border-bd rounded-2xl p-4 mb-3">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-a font-bold text-sm">⚡ {f.code}</div>
                  <div className="font-semibold text-sm mt-0.5">{f.name}</div>
                  <div className="text-[10px] text-mu mt-1 flex gap-3 flex-wrap">
                    {f.voltage_kv&&<span>{f.voltage_kv}kV</span>}
                    {f.source_substation&&<span>📡 {f.source_substation}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={()=>openEdit(f)} className="px-2 py-1.5 rounded-lg border border-bd text-mu text-[10px]">✏️</button>
                  <button onClick={()=>del(f)} className="px-2 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-[10px]">🗑</button>
                </div>
              </div>
              {dtrs.length>0 && (
                <div className="mb-3">
                  <div className="flex justify-between text-[9px] mb-1">
                    <span className="text-mu">Load</span>
                    <span className="font-mono font-bold" style={{color:loadColor}}>{Math.round(load)}%</span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${Math.min(load,100)}%`,background:loadColor}} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[['🔆',dtrs.length,'DTRs'],['🔌',meters.length,'Meters'],['🪧',poles.length,'Poles']].map(([ic,n,l])=>(
                  <div key={l} className="bg-bg rounded-xl p-2 text-center">
                    <div className="text-base">{ic}</div>
                    <div className="font-mono font-bold text-sm text-tx">{n}</div>
                    <div className="text-[9px] text-mu">{l}</div>
                  </div>
                ))}
              </div>
              {(f.ht_length_km||f.lt_length_km)&&(
                <div className="mt-2 text-[10px] text-mu flex gap-3">
                  {f.ht_length_km>0&&<span>HT: {f.ht_length_km}km</span>}
                  {f.lt_length_km>0&&<span>LT: {f.lt_length_km}km</span>}
                  {f.sanctioned_load_kva>0&&<span>Sanctioned: {f.sanctioned_load_kva}kVA</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">{form._id?'✏️ Edit':'⚡ New'} Feeder</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Code *</label>
                  <input className={inp} placeholder="F-07" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} disabled={!!form._id} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Voltage</label>
                  <select className={inp} value={form.voltage_kv} onChange={e=>setForm({...form,voltage_kv:e.target.value})}>
                    <option value="11">11 kV</option><option value="33">33 kV</option><option value="0.4">LT 0.4kV</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-mu block mb-1">Name *</label>
                <input className={inp} placeholder="F-07 Jhalawar" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-mu block mb-1">HT Length (km)</label>
                  <input type="number" className={inp} value={form.ht_length_km||''} onChange={e=>setForm({...form,ht_length_km:e.target.value})} /></div>
                <div><label className="text-[10px] text-mu block mb-1">LT Length (km)</label>
                  <input type="number" className={inp} value={form.lt_length_km||''} onChange={e=>setForm({...form,lt_length_km:e.target.value})} /></div>
                <div><label className="text-[10px] text-mu block mb-1">Sanctioned Load (kVA)</label>
                  <input type="number" className={inp} value={form.sanctioned_load_kva||''} onChange={e=>setForm({...form,sanctioned_load_kva:e.target.value})} /></div>
                <div><label className="text-[10px] text-mu block mb-1">Source GSS</label>
                  <input className={inp} placeholder="33/11kV GSS" value={form.source_substation||''} onChange={e=>setForm({...form,source_substation:e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-mu block mb-1">Remarks</label>
                <textarea className={inp} rows={2} value={form.remarks||''} onChange={e=>setForm({...form,remarks:e.target.value})} /></div>
              <div className="flex gap-3 pt-1">
                <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':'💾 Save'}
                </button>
                <button onClick={()=>setForm(null)} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FeedersPage
