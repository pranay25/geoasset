import { useEffect, useState } from 'react'
import { useWOStore, useAssetStore, useFeederStore, useUserStore, useAuthStore, useUIStore } from '../store/index.js'
import { woApi } from '../api/client.js'
import { ASSET_TYPES, PRIORITY_COLORS, STATUS_COLORS, CONDUCTORS, IE_CLEARANCE, haversine, calcSag, sagVerdict, waOpen, buildWOMessage } from '../utils/constants.js'

export default function WorkOrdersPage() {
  const { wos, fetch, add, update } = useWOStore()
  const { assets } = useAssetStore()
  const { feeders } = useFeederStore()
  const { users, fetch: fetchUsers } = useUserStore()
  const { profile, org, canManageUsers } = useAuthStore()
  const { toast } = useUIStore()

  const [filterStatus, setFilterStatus] = useState('open')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [issueType, setIssueType] = useState('')
  const [priority, setPriority] = useState('normal')
  const [dueDate, setDueDate] = useState('')
  const [feederId, setFeederId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [selectedAssets, setSelectedAssets] = useState([])
  const [assetQ, setAssetQ] = useState('')
  const [spans, setSpans] = useState([])

  // Sag calculator
  const [sagFrom, setSagFrom] = useState('')
  const [sagTo, setSagTo] = useState('')
  const [sagConductor, setSagConductor] = useState(0)
  const [sagHeight, setSagHeight] = useState(9)

  useEffect(() => { fetch(); fetchUsers() }, [])

  function resetForm() {
    setTitle('');setIssueType('');setPriority('normal');setDueDate('');setFeederId('');setAssigneeId('')
    setRemarks('');setSelectedAssets([]);setAssetQ('');setSpans('')
    setSagFrom('');setSagTo('');setSagConductor(0);setSagHeight(9)
  }

  function toggleAsset(a) {
    setSelectedAssets(s => s.some(x=>x.id===a.id) ? s.filter(x=>x.id!==a.id) : [...s,a])
  }

  function addSpan() {
    const from = assets.find(a=>a.id===sagFrom), to = assets.find(a=>a.id===sagTo)
    if (!from||!to) return toast('Select two poles','err')
    const span = Math.round(haversine(parseFloat(from.latitude),parseFloat(from.longitude),parseFloat(to.latitude),parseFloat(to.longitude)))
    const cond = CONDUCTORS[sagConductor]
    const { sag } = calcSag({ span, conductorWeight:cond.weight, tension:cond.tension })
    const groundClearance = sagHeight - sag
    const lineType = from.details?.line_type||'LT'
    const lt = lineType.includes('33')?'HT 33kV':lineType.includes('11')?'HT 11kV':'LT'
    const verd = sagVerdict(groundClearance, lt)
    setSpans(sp=>[...sp,{
      from_id:from.id,from_name:from.name,to_id:to.id,to_name:to.name,
      span_length_m:span,conductor:cond.label,sag_vertical_m:sag,
      ground_clearance_m:+groundClearance.toFixed(2),line_type:lt,...verd
    }])
    toast(`Span added: ${span}m span, sag ${sag}m — ${verd.verdict.toUpperCase()}`,'ok')
  }

  async function submit() {
    if (!title) return toast('Title required','err')
    if (!selectedAssets.length) return toast('Select at least one asset','err')
    setSaving(true)
    try {
      const wo = await woApi.create({
        title, issue_type:issueType, priority, due_date:dueDate||null,
        feeder_id:feederId||null, assigned_to_id:assigneeId||null,
        created_by_id:profile?.id, remarks,
        asset_ids:selectedAssets.map(a=>a.id), spans,
      })
      add({ ...wo, profiles:users.find(u=>u.id===assigneeId) })
      toast(`✅ ${wo.wo_number} created`,'ok')
      setShowForm(false); resetForm()
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function closeWO(wo) {
    const updated = await woApi.close(wo.id,'Completed')
    update(wo.id, updated)
    toast('✅ WO closed','ok')
  }

  function shareWO(wo) {
    const woAssets = (wo.asset_ids||[]).map(id=>assets.find(a=>a.id===id)).filter(Boolean)
    waOpen(buildWOMessage(wo, woAssets, org))
  }

  const filtered = wos.filter(w=>filterStatus==='all'?true:w.status===filterStatus)
  const poles = assets.filter(a=>a.asset_type==='pole')
  const jefi = users.filter(u=>u.is_active&&(u.role==='je'||u.role==='feeder_incharge'))
  const filteredAssets = assets.filter(a=>{
    if (!assetQ) return true
    return (a.name+(a.details?.consumer_name||'')).toLowerCase().includes(assetQ.toLowerCase())
  })

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2 text-sm text-tx focus:outline-none focus:border-a"

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-0 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-rajdhani font-bold text-sm">Work Orders</div>
          <button onClick={()=>setShowForm(true)} className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">+ New WO</button>
        </div>
        <div className="flex gap-1.5">
          {['open','assigned','closed','all'].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold border transition-colors
                ${filterStatus===s?'bg-a text-bg border-a':'bg-sf text-mu border-bd'}`}>
              {s.charAt(0).toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
        {filtered.map(wo => {
          const woAssets = (wo.asset_ids||[]).map(id=>assets.find(a=>a.id===id)).filter(Boolean)
          return (
            <div key={wo.id} className="bg-sf border border-bd rounded-2xl p-4 mb-3">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-mono text-[11px] text-mu">{wo.wo_number}</div>
                  <div className="font-semibold text-sm mt-0.5">{wo.title}</div>
                </div>
                <div className="flex gap-1 items-center flex-shrink-0">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{background:PRIORITY_COLORS[wo.priority]+'22',color:PRIORITY_COLORS[wo.priority]}}>
                    {wo.priority?.toUpperCase()}
                  </span>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{background:STATUS_COLORS[wo.status]+'22',color:STATUS_COLORS[wo.status]}}>
                    {wo.status?.toUpperCase()}
                  </span>
                </div>
              </div>

              {wo.issue_type&&<div className="text-[10px] text-mu mb-2">Issue: {wo.issue_type}</div>}

              {woAssets.length>0&&(
                <div className="flex flex-wrap gap-1 mb-2">
                  {woAssets.map(a=>(
                    <span key={a.id} className="text-[9px] px-2 py-0.5 rounded-full border border-bd bg-bg">
                      {ASSET_TYPES[a.asset_type]?.icon} {a.name}
                    </span>
                  ))}
                </div>
              )}

              {(wo.spans||[]).map((s,i)=>(
                <div key={i} className="text-[9px] font-mono py-1 border-t border-bd/50 flex items-center gap-2">
                  <span className="text-mu">{s.from_name}→{s.to_name}</span>
                  <span>{s.span_length_m}m · sag {s.sag_vertical_m}m</span>
                  <span className="font-bold" style={{color:s.color}}>{s.verdict?.toUpperCase()}</span>
                </div>
              ))}

              <div className="flex items-center gap-2 mt-3 text-[10px] text-mu">
                {wo.due_date&&<span>📅 {wo.due_date}</span>}
                {wo.profiles?.name&&<span>👤 {wo.profiles.name}</span>}
                {wo.feeders?.code&&<span>⚡ {wo.feeders.code}</span>}
              </div>

              <div className="flex gap-2 mt-3">
                {wo.status!=='closed'&&(
                  <button onClick={()=>closeWO(wo)}
                    className="flex-1 py-2 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-[11px] font-bold">
                    ✅ Close
                  </button>
                )}
                <button onClick={()=>shareWO(wo)}
                  className="flex-1 py-2 rounded-xl border border-a/30 bg-a/10 text-a text-[11px] font-bold">
                  📱 WA Share
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Create WO form */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setShowForm(false)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">🔧 New Work Order</div>

            <div className="space-y-3">
              <div><label className="text-[10px] text-mu block mb-1">Title *</label>
                <input className={inp} value={title} onChange={e=>setTitle(e.target.value)} placeholder="WO title" /></div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-mu block mb-1">Issue Type</label>
                  <select className={inp} value={issueType} onChange={e=>setIssueType(e.target.value)}>
                    <option value="">Select…</option>
                    {['Cable Sag','Transformer Fault','Meter Bypass','Pole Leaning','Fuse Blown','Overloading','Earthing Fault','Other'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className="text-[10px] text-mu block mb-1">Priority</label>
                  <select className={inp} value={priority} onChange={e=>setPriority(e.target.value)}>
                    <option value="urgent">🔴 Urgent</option><option value="high">🟠 High</option>
                    <option value="normal">🔵 Normal</option><option value="low">⚫ Low</option>
                  </select>
                </div>
                <div><label className="text-[10px] text-mu block mb-1">Due Date</label>
                  <input type="date" className={inp} value={dueDate} onChange={e=>setDueDate(e.target.value)} /></div>
                <div><label className="text-[10px] text-mu block mb-1">Assign To</label>
                  <select className={inp} value={assigneeId} onChange={e=>setAssigneeId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {jefi.map(u=><option key={u.id} value={u.id}>{u.role==='je'?'JE':'FI'} – {u.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Asset picker */}
              <div>
                <label className="text-[10px] text-mu block mb-1">Assets *</label>
                <input className={inp+' mb-2'} placeholder="Search assets…" value={assetQ} onChange={e=>setAssetQ(e.target.value)} />
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {filteredAssets.slice(0,30).map(a=>(
                    <button key={a.id} onClick={()=>toggleAsset(a)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors
                        ${selectedAssets.some(x=>x.id===a.id)?'bg-a/10 border border-a/30 text-a':'bg-bg border border-bd text-mu'}`}>
                      <span className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]"
                        style={selectedAssets.some(x=>x.id===a.id)?{background:'var(--tw-color-a,#00d4ff)',color:'#000',borderColor:'transparent'}:{borderColor:'currentColor'}}>
                        {selectedAssets.some(x=>x.id===a.id)?'✓':''}
                      </span>
                      <span>{ASSET_TYPES[a.asset_type]?.icon} {a.name}</span>
                    </button>
                  ))}
                </div>
                {selectedAssets.length>0&&(
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedAssets.map(a=>(
                      <span key={a.id} className="text-[9px] px-2 py-0.5 rounded-full bg-a/10 border border-a/30 text-a flex items-center gap-1">
                        {a.name}<button onClick={()=>toggleAsset(a)} className="ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Sag calculator */}
              <div className="bg-bg border border-bd rounded-xl p-3">
                <div className="text-[10px] text-a font-bold tracking-wider mb-2">📐 SAG CALCULATOR</div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="text-[9px] text-mu block mb-1">From Pole</label>
                    <select className={inp+' text-xs'} value={sagFrom} onChange={e=>setSagFrom(e.target.value)}>
                      <option value="">Select…</option>
                      {poles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[9px] text-mu block mb-1">To Pole</label>
                    <select className={inp+' text-xs'} value={sagTo} onChange={e=>setSagTo(e.target.value)}>
                      <option value="">Select…</option>
                      {poles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[9px] text-mu block mb-1">Conductor</label>
                    <select className={inp+' text-xs'} value={sagConductor} onChange={e=>setSagConductor(parseInt(e.target.value))}>
                      {CONDUCTORS.map((c,i)=><option key={i} value={i}>{c.label}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[9px] text-mu block mb-1">Pole Height (m)</label>
                    <input type="number" className={inp+' text-xs'} value={sagHeight} onChange={e=>setSagHeight(parseFloat(e.target.value)||9)} />
                  </div>
                </div>
                <button onClick={addSpan} className="w-full py-2 rounded-lg bg-a/10 border border-a/30 text-a text-xs font-bold">
                  + Add Span
                </button>
                {spans.map((s,i)=>(
                  <div key={i} className="mt-2 text-[10px] font-mono border-t border-bd/50 pt-1 flex items-center gap-2">
                    <span>{s.from_name}→{s.to_name}: {s.span_length_m}m · sag {s.sag_vertical_m}m</span>
                    <span className="font-bold" style={{color:s.color}}>{s.verdict?.toUpperCase()}</span>
                    <button onClick={()=>setSpans(sp=>sp.filter((_,j)=>j!==i))} className="ml-auto text-red-400">✕</button>
                  </div>
                ))}
              </div>

              <div><label className="text-[10px] text-mu block mb-1">Remarks</label>
                <textarea className={inp} rows={2} value={remarks} onChange={e=>setRemarks(e.target.value)} /></div>

              <div className="flex gap-3 pt-1">
                <button onClick={submit} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':'🔧 Create WO'}
                </button>
                <button onClick={()=>setShowForm(false)} className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
