// ─── AssetsPage ──────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useAssetStore, useWOStore, useGroupStore, useAuthStore, useUIStore } from '../store/index.js'
import { assetsApi, groupsApi } from '../api/client.js'
import { ASSET_TYPES, STATUS_COLORS, fmtOut, outColor, waOpen, buildConsumerNotice } from '../utils/constants.js'

export function AssetsPage() {
  const { assets, fetch, update } = useAssetStore()
  const { wos } = useWOStore()
  const { org, profile } = useAuthStore()
  const { toast } = useUIStore()
  const { groups, fetch: fetchGroups, add: addGroup, update: updateGroup, remove: removeGroup } = useGroupStore()

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [showGroups, setShowGroups] = useState(false)

  useEffect(() => { fetch(); fetchGroups() }, [])

  const filtered = assets.filter(a => {
    if (filter==='flagged') return a.status!=='ok'
    if (filter==='out_high') return a.asset_type==='meter'&&(a.outstanding_amount||0)>=10000
    if (filter==='out_any')  return a.asset_type==='meter'&&(a.outstanding_amount||0)>0
    if (filter!=='all') return a.asset_type===filter
    return true
  }).filter(a => {
    if (!q) return true
    const s = (a.name+(a.details?.consumer_name||'')+(a.details?.k_number||'')+String(a.outstanding_amount||'')).toLowerCase()
    return s.includes(q.toLowerCase())
  }).sort((a,b) => {
    if (filter.startsWith('out')) return (b.outstanding_amount||0)-(a.outstanding_amount||0)
    return 0
  })

  async function flag(a) {
    const ns = a.status==='flag'?'ok':'flag'
    const updated = await assetsApi.update(a.id,{status:ns,flag_note:ns==='flag'?'Flagged':null})
    update(a.id,{status:ns,flag_note:updated.flag_note})
    toast(ns==='flag'?'🚩 Flagged':'✅ Unflagged','ok')
  }

  const CHIPS = [
    {id:'all',label:'All'},
    ...Object.entries(ASSET_TYPES).map(([id,{label,icon}])=>({id,label:`${icon} ${label.split(' ')[0]}`})),
    {id:'flagged',label:'🚩 Flagged'},
    {id:'out_high',label:'💰 High ≥₹10K'},
    {id:'out_any',label:'₹ Any Outstg'},
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Search + Groups */}
      <div className="p-3 pb-0 space-y-2 flex-shrink-0">
        <div className="flex gap-2">
          <input placeholder="Search K.No., asset…" value={q} onChange={e=>setQ(e.target.value)}
            className="flex-1 bg-sf border border-bd rounded-xl px-3 py-2 text-sm text-tx focus:outline-none focus:border-a" />
          <button onClick={()=>setShowGroups(true)}
            className="px-3 py-2 rounded-xl bg-sf border border-bd text-[11px] font-bold text-amber-400 border-amber-500/30 flex-shrink-0">
            💰 Groups
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {CHIPS.map(c=>(
            <button key={c.id} onClick={()=>setFilter(c.id)}
              className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors
                ${filter===c.id?'bg-a text-bg border-a':'bg-sf text-mu border-bd'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-mu font-mono">{filtered.length} assets</div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {filtered.map(a => {
          const cfg = ASSET_TYPES[a.asset_type]
          const out = a.outstanding_amount||0
          const hasWO = wos.some(w=>w.status!=='closed'&&(w.asset_ids||[]).includes(a.id))
          return (
            <button key={a.id} onClick={()=>setModal(a)}
              className="w-full flex items-center gap-3 p-3 rounded-xl mb-2 bg-sf border border-bd hover:border-bd2 text-left transition-colors">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{background:cfg?.bg||'rgba(100,100,100,.15)'}}>
                {out>=10000?'₹':cfg?.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{a.name}</span>
                  {hasWO&&<span className="text-[9px] text-amber-400">🔧</span>}
                  {out>=10000&&<span className="text-[9px] font-mono font-bold" style={{color:outColor(out)}}>{fmtOut(out)}</span>}
                </div>
                <div className="text-[10px] text-mu mt-0.5 truncate">
                  {cfg?.label}{a.details?.consumer_name?` · ${a.details.consumer_name}`:''}
                  {a.details?.category?` · ${a.details.category}`:''}
                </div>
              </div>
              <div className={`w-2 h-2 rounded-full flex-shrink-0`}
                style={{background:STATUS_COLORS[a.status]||'#888'}} />
            </button>
          )
        })}
      </div>

      {/* Asset Modal */}
      {modal && (
        <AssetModal asset={modal} org={org} onClose={()=>setModal(null)}
          onFlag={()=>{ flag(modal); setModal(null) }} />
      )}

      {/* Groups Panel */}
      {showGroups && (
        <GroupsPanel assets={assets} groups={groups} org={org} profile={profile}
          onAdd={addGroup} onUpdate={updateGroup} onRemove={removeGroup}
          onClose={()=>setShowGroups(false)} toast={toast} />
      )}
    </div>
  )
}

function AssetModal({ asset: a, org, onClose, onFlag }) {
  const cfg = ASSET_TYPES[a.asset_type]
  const out = a.outstanding_amount||0
  const rows = [
    ['Type', cfg?.label], ['Asset Code', a.asset_code],
    ['Status', a.status.toUpperCase()],
    a.flag_note ? ['Flag Note', a.flag_note] : null,
    ...Object.entries(a.details||{}).map(([k,v])=>[k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), String(v)]),
    out>0 ? ['Outstanding', `₹${out.toLocaleString('en-IN')}`] : null,
    a.last_payment_date ? ['Last Payment', a.last_payment_date] : null,
    a.mobile ? ['Mobile', a.mobile] : null,
    ['Latitude', parseFloat(a.latitude).toFixed(6)+'°N'],
    ['Longitude', parseFloat(a.longitude).toFixed(6)+'°E'],
    a.survey_accuracy_m ? ['GPS Accuracy', `±${a.survey_accuracy_m}m`] : null,
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={onClose}>
      <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto"
        onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
            style={{background:cfg?.bg}}>
            {cfg?.icon}
          </div>
          <div>
            <div className="font-bold text-base">{a.name}</div>
            <div className="text-mu text-xs">{a.asset_code}</div>
          </div>
          {out>0&&<div className="ml-auto text-sm font-bold font-mono" style={{color:outColor(out)}}>₹{out.toLocaleString('en-IN')}</div>}
        </div>

        <div className="space-y-2 mb-4">
          {rows.map(([k,v],i) => (
            <div key={i} className="flex justify-between items-center py-1.5 border-b border-bd/50 text-xs">
              <span className="text-mu capitalize">{k}</span>
              <span className="font-medium text-right max-w-[60%] truncate"
                style={k==='Outstanding'?{color:outColor(out)}:{}}>
                {k==='Mobile' ? (
                  <a href={`tel:${v}`} className="text-green-400 underline">{v}</a>
                ) : v}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-sf2 border border-bd text-xs font-bold text-mu">Close</button>
          <button onClick={onFlag} className="px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold">
            {a.status==='flag'?'✅ Unflag':'🚩 Flag'}
          </button>
          {a.mobile && (
            <a href={`tel:${a.mobile}`} className="px-4 py-2.5 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-bold">📞 Call</a>
          )}
          {a.mobile && out>0 && org && (
            <button onClick={()=>{ waOpen(buildConsumerNotice(a,org)); onClose() }}
              className="px-4 py-2.5 rounded-xl border border-a/30 bg-a/10 text-a text-xs font-bold">📱 WA Notice</button>
          )}
          <a href={`https://maps.google.com/?q=${a.latitude},${a.longitude}`} target="_blank" rel="noreferrer"
            className="px-4 py-2.5 rounded-xl border border-bd bg-sf2 text-mu text-xs font-bold">📍 Maps</a>
        </div>
      </div>
    </div>
  )
}

function GroupsPanel({ assets, groups, org, profile, onAdd, onUpdate, onRemove, onClose, toast }) {
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState(null)
  const [name, setName] = useState(''), [color, setColor] = useState('#ef4444')
  const [minOut, setMinOut] = useState(''), [selected, setSelected] = useState(new Set())
  const [gq, setGq] = useState('')

  const meters = assets.filter(a=>a.asset_type==='meter').sort((a,b)=>(b.outstanding_amount||0)-(a.outstanding_amount||0))
  const filtered = meters.filter(m=>{
    const s=(m.name+(m.details?.consumer_name||'')).toLowerCase()
    return !gq||s.includes(gq.toLowerCase())
  })

  function toggle(id) { setSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n }) }
  function autoAdd() {
    const min=parseFloat(minOut)||0
    meters.filter(m=>(m.outstanding_amount||0)>=min&&min>0).forEach(m=>setSelected(s=>new Set([...s,m.id])))
  }

  async function save() {
    if (!name) return toast('Group name required','err')
    if (!selected.size) return toast('Select at least one consumer','err')
    const payload = { name, color, min_outstanding:parseFloat(minOut)||0, meter_ids:[...selected], created_by_id:profile?.id }
    if (editId) {
      const g = await groupsApi.update(editId, payload); onUpdate(editId, g)
      toast('✅ Group updated','ok')
    } else {
      const g = await groupsApi.create(payload); onAdd(g)
      toast('✅ Group created','ok')
    }
    setCreating(false); setEditId(null); setName(''); setSelected(new Set())
  }

  function startEdit(g) {
    setEditId(g.id); setName(g.name); setColor(g.color)
    setMinOut(g.min_outstanding||'')
    setSelected(new Set(g.meter_ids||[]))
    setCreating(true)
  }

  async function del(id) {
    if(!confirm('Delete group?')) return
    await groupsApi.delete(id); onRemove(id); toast('🗑 Deleted','ok')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={onClose}>
      <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[90vh] overflow-y-auto"
        onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <div className="font-rajdhani font-bold text-amber-400">💰 Outstanding Groups</div>
          <button onClick={()=>setCreating(c=>!c)}
            className="px-3 py-1.5 rounded-lg bg-a/10 border border-a/30 text-a text-xs font-bold">
            {creating?'✕ Cancel':'+ New Group'}
          </button>
        </div>

        {creating && (
          <div className="bg-bg border border-bd rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-mu block mb-1">Group Name</label>
                <input className="w-full bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none focus:border-a"
                  value={name} onChange={e=>setName(e.target.value)} placeholder="Recovery Zone A" />
              </div>
              <div>
                <label className="text-[10px] text-mu block mb-1">Colour</label>
                <select className="w-full bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none"
                  value={color} onChange={e=>setColor(e.target.value)}>
                  {[['#ef4444','🔴 Red'],['#f97316','🟠 Orange'],['#eab308','🟡 Yellow'],['#8b5cf6','🟣 Purple'],['#06b6d4','🔵 Cyan']].map(([v,l])=>(
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-mu block mb-1">Min Outstanding (₹)</label>
                <div className="flex gap-1">
                  <input type="number" className="flex-1 bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none"
                    value={minOut} onChange={e=>setMinOut(e.target.value)} placeholder="10000" />
                  <button onClick={autoAdd} className="px-2 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-bold">Auto</button>
                </div>
              </div>
            </div>
            <div>
              <input className="w-full bg-sf border border-bd rounded-lg px-3 py-2 text-xs text-tx focus:outline-none mb-2"
                placeholder="Search consumer…" value={gq} onChange={e=>setGq(e.target.value)} />
              <div className="max-h-40 overflow-y-auto space-y-1">
                {filtered.map(m=>(
                  <button key={m.id} onClick={()=>toggle(m.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors
                      ${selected.has(m.id)?'bg-a/10 border border-a/30 text-a':'bg-sf border border-bd text-mu'}`}>
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]
                      ${selected.has(m.id)?'bg-a border-a text-bg':'border-bd'}`}>
                      {selected.has(m.id)?'✓':''}
                    </div>
                    <span className="flex-1 truncate">{m.name} · {m.details?.consumer_name||''}</span>
                    {(m.outstanding_amount||0)>0&&<span className="font-mono font-bold text-amber-400">{fmtOut(m.outstanding_amount)}</span>}
                  </button>
                ))}
              </div>
              {selected.size>0&&<div className="text-[10px] text-a mt-1">{selected.size} selected</div>}
            </div>
            <button onClick={save} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-bg font-rajdhani font-bold text-sm">
              💾 Save Group
            </button>
          </div>
        )}

        {groups.map(g => {
          const gMeters = (g.meter_ids||[]).map(id=>assets.find(a=>a.id===id)).filter(Boolean)
          const tot = gMeters.reduce((s,m)=>s+(m.outstanding_amount||0),0)
          return (
            <div key={g.id} className="bg-sf2 border border-bd rounded-xl p-3 mb-3"
              style={{borderLeft:`3px solid ${g.color}`}}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-bold text-sm">{g.name}</div>
                  <div className="text-[10px] text-mu">{gMeters.length} consumers · ₹{tot.toLocaleString('en-IN')}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={()=>startEdit(g)} className="px-2 py-1 rounded-lg border border-bd text-mu text-[10px]">✏️</button>
                  <button onClick={()=>{ if(org) waOpen(require('../utils/constants.js').buildGroupMessage(g,gMeters,org)) }}
                    className="px-2 py-1 rounded-lg border border-green-500/30 text-green-400 text-[10px]">📱</button>
                  <button onClick={()=>del(g.id)} className="px-2 py-1 rounded-lg border border-red-500/30 text-red-400 text-[10px]">🗑</button>
                </div>
              </div>
              {gMeters.slice(0,3).map(m=>(
                <div key={m.id} className="flex items-center justify-between py-1 border-t border-bd/50 text-[10px]">
                  <span className="font-mono">{m.name}</span>
                  <span className="text-mu truncate mx-2">{m.details?.consumer_name||''}</span>
                  <span className="font-bold" style={{color:outColor(m.outstanding_amount||0)}}>₹{(m.outstanding_amount||0).toLocaleString('en-IN')}</span>
                  {m.mobile&&<a href={`tel:${m.mobile}`} className="ml-1 text-green-400">📞</a>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AssetsPage
