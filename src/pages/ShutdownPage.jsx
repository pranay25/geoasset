import { useEffect, useState } from 'react'
import { useFeederStore, useAssetStore, useSubstationStore, useAuthStore, useUIStore } from '../store/index.js'
import { shutdownApi, auditApi } from '../api/client.js'

export default function ShutdownPage() {
  const { feeders, fetch: fetchFeeders } = useFeederStore()
  const { assets } = useAssetStore()
  const { substations, fetch: fetchSubstations } = useSubstationStore()
  const { profile, org } = useAuthStore()
  const { toast } = useUIStore()

  const [shutdowns, setShutdowns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('active')

  // Form state
  const [form, setForm] = useState({
    substation_id: '', feeder_id: '', shutdown_type: 'planned',
    reason: '', estimated_restore: '',
  })

  useEffect(() => {
    fetchFeeders()
    fetchSubstations()
    loadShutdowns()
  }, [])

  async function loadShutdowns() {
    setLoading(true)
    try {
      const data = await shutdownApi.list()
      setShutdowns(data)
    } catch(e) { toast(e.message, 'err') }
    finally { setLoading(false) }
  }

  // Get unique substation names from feeders
  // substations comes from useSubstationStore — proper entities

  // Get feeders for selected substation
  const relatedFeeders = form.substation_id
    ? feeders.filter(f => f.substation_id === form.substation_id)
    : []
  const feederOptions = relatedFeeders.length > 0 ? relatedFeeders : feeders

  async function postShutdown() {
    if (!form.substation_id) return toast('Select substation', 'err')
    if (!form.reason) return toast('Enter shutdown reason', 'err')
    setSaving(true)
    try {
      const affected = form.feeder_id ? [form.feeder_id] : relatedFeeders.map(f => f.id)
          // Get substation record for GPS coords
      const substationRecord = substations.find(s => s.id === form.substation_id)
      const sd = await shutdownApi.create({
        substation_id: form.substation_id || null,
        substation_name: substationRecord?.name || form.substation_name || 'Unknown',
        shutdown_type: form.shutdown_type,
        reason: form.reason,
        estimated_restore: form.estimated_restore ? new Date(form.estimated_restore).toISOString() : null,
        affected_feeders: affected,
        posted_by_id: profile?.id,
        status: 'active',
        substation_lat: substationRecord?.latitude || org?.lat || null,
        substation_lng: substationRecord?.longitude || org?.lng || null,
      })
      setShutdowns(prev => [{ ...sd, feeders: feeders.find(f=>f.id===form.feeder_id), profiles: profile }, ...prev])
      await auditApi.log({
        action: 'SHUTDOWN_POSTED', category: 'system', severity: 'critical',
        description: `Shutdown posted: ${substations.find(s=>s.id===form.substation_id)?.name||'?'} — ${form.reason}`,
        meta: { substation: form.substation_name, affected_feeders: affected.length, type: form.shutdown_type },
      })
      toast('⚠️ Shutdown alert sent to all users', 'warn')
      setShowForm(false)
      setForm({ substation_name:'', feeder_id:'', shutdown_type:'planned', reason:'', estimated_restore:'' })
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function restore(sd) {
    const note = prompt('Restoration note (optional):') ?? ''
    try {
      const updated = await shutdownApi.restore(sd.id, note)
      setShutdowns(prev => prev.map(s => s.id===sd.id ? { ...s, ...updated } : s))
      await auditApi.log({
        action: 'FEEDER_RESTORED', category: 'system', severity: 'info',
        description: `Feeder restored: ${sd.substation_name}${note ? ' — '+note : ''}`,
        meta: { shutdown_id: sd.id, substation: sd.substation_name, note },
      })
      toast('✅ Restoration alert sent', 'ok')
    } catch(e) { toast(e.message, 'err') }
  }

  const active   = shutdowns.filter(s => s.status === 'active')
  const restored = shutdowns.filter(s => s.status === 'restored')
  const displayed = tab === 'active' ? active : restored

  const TYPE_COLORS = {
    planned:     { color:'#3b82f6', bg:'rgba(59,130,246,0.12)',  label:'Planned'     },
    emergency:   { color:'#ef4444', bg:'rgba(239,68,68,0.12)',   label:'Emergency'   },
    maintenance: { color:'#f59e0b', bg:'rgba(245,158,11,0.12)',  label:'Maintenance' },
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  function fmtDt(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
  }

  function duration(start) {
    const diff = Date.now() - new Date(start)
    const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-rajdhani font-bold text-sm text-tx">⚡ Shutdown Manager</div>
            <div className="text-[10px] text-mu mt-0.5">Real-time alerts to all connected users</div>
          </div>
          <div className="flex gap-2">
            <a href="/outages" target="_blank" rel="noreferrer"
              className="px-3 py-2 rounded-xl border border-a/30 bg-a/10 text-a text-xs font-bold">
              🌐 Public Board
            </a>
            <button onClick={() => setShowForm(true)}
              className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold">
              ⚠️ Post Shutdown
            </button>
          </div>
        </div>

        {/* Active count banner */}
        {active.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-red-400 text-xs font-bold">{active.length} ACTIVE SHUTDOWN{active.length>1?'S':''}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2">
          {[['active',`Active (${active.length})`],['history',`History (${restored.length})`]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 py-2 rounded-xl font-bold text-xs border transition-colors
                ${tab===id ? 'bg-a text-bg border-a' : 'bg-sf text-mu border-bd'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Shutdown list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <div className="text-center py-8 text-mu text-sm animate-pulse">Loading…</div>}

        {!loading && displayed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-mu">
            <div className="text-5xl mb-3">{tab==='active'?'✅':'📋'}</div>
            <div className="text-sm">{tab==='active'?'No active shutdowns':'No shutdown history'}</div>
          </div>
        )}

        {displayed.map(sd => {
          const tc = TYPE_COLORS[sd.shutdown_type] || TYPE_COLORS.planned
          const affectedNames = (sd.affected_feeders||[])
            .map(id => feeders.find(f=>f.id===id)?.code).filter(Boolean)
          return (
            <div key={sd.id} className={`rounded-2xl border overflow-hidden
              ${sd.status==='active' ? 'border-red-500/40' : 'border-bd'}`}>

              {/* Status bar */}
              <div className={`px-4 py-2 flex items-center justify-between text-xs font-bold
                ${sd.status==='active' ? 'bg-red-500/15' : 'bg-green-500/10'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${sd.status==='active'?'bg-red-400 animate-pulse':'bg-green-400'}`} />
                  <span style={{ color: sd.status==='active'?'#f87171':'#4ade80' }}>
                    {sd.status==='active' ? '⚠️ ACTIVE SHUTDOWN' : '✅ RESTORED'}
                  </span>
                </div>
                <span className="font-mono text-mu">{duration(sd.start_time)} ago</span>
              </div>

              <div className="p-4">
                {/* Title */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-bold text-base">🏭 {sd.substation_name}</div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background:tc.bg, color:tc.color }}>{tc.label}</span>
                      {sd.feeders?.code && (
                        <span className="text-[9px] text-mu border border-bd px-2 py-0.5 rounded-full">
                          ⚡ {sd.feeders.code}
                        </span>
                      )}
                    </div>
                  </div>
                  {sd.status==='active' && (profile?.role==='je'||profile?.role==='admin'||profile?.role==='sdo') && (
                    <button onClick={() => restore(sd)}
                      className="px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold flex-shrink-0">
                      ✅ Restore
                    </button>
                  )}
                </div>

                {/* Reason */}
                <div className="bg-bg rounded-xl p-3 mb-3 text-sm text-tx">{sd.reason}</div>

                {/* Times */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                  <div className="bg-sf2 rounded-xl p-2">
                    <div className="text-mu mb-0.5">Started</div>
                    <div className="font-mono font-bold">{fmtDt(sd.start_time)}</div>
                  </div>
                  {sd.status==='active' ? (
                    <div className="bg-sf2 rounded-xl p-2">
                      <div className="text-mu mb-0.5">Est. Restore</div>
                      <div className="font-mono font-bold">{fmtDt(sd.estimated_restore)}</div>
                    </div>
                  ) : (
                    <div className="bg-green-500/10 rounded-xl p-2">
                      <div className="text-mu mb-0.5">Restored</div>
                      <div className="font-mono font-bold text-green-400">{fmtDt(sd.actual_restore)}</div>
                    </div>
                  )}
                </div>

                {/* Affected feeders */}
                {affectedNames.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] text-mu mb-1.5">Affected Feeders ({affectedNames.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {affectedNames.map(code => (
                        <span key={code} className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                          ⚡ {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Posted by + ack count */}
                <div className="flex items-center justify-between text-[10px] text-mu">
                  <span>Posted by: {sd.profiles?.name || '—'} ({sd.profiles?.employee_id})</span>
                  <span>{(sd.acknowledged_by||[]).length} acknowledged</span>
                </div>

                {sd.restore_note && (
                  <div className="mt-2 text-xs text-green-400 bg-green-500/10 rounded-xl p-2">
                    📝 {sd.restore_note}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Post Shutdown Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setShowForm(false)}>
          <div className="w-full bg-sf border-t-2 border-red-500/40 rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-3" />
            <div className="flex items-center gap-2 mb-4">
              <div className="text-2xl animate-pulse">⚠️</div>
              <div>
                <div className="font-rajdhani font-bold text-base text-red-400">Post Shutdown Alert</div>
                <div className="text-[10px] text-mu">All connected users will be notified immediately</div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Substation */}
              <div>
                <label className="text-[10px] text-mu block mb-1.5">Substation *</label>
                <select className={inp} value={form.substation_id}
                  onChange={e => setForm({...form, substation_id:e.target.value, feeder_id:''})}>
                  <option value="">Select substation…</option>
                  {substations.map(s => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.voltage_ratio})</option>
                  ))}
                </select>
                {substations.length===0&&<div className="text-[10px] text-amber-400 mt-1">⚠️ No substations found — add them in Substations tab first</div>}
              </div>

              {/* Affected feeders preview */}
              {form.substation_name && feederOptions.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <div className="text-[10px] text-red-400 font-bold mb-1.5">
                    {relatedFeeders.length > 0 ? `Will alert ${relatedFeeders.length} linked feeder(s):` : `Select specific feeder or leave blank for all:`}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {feederOptions.slice(0,8).map(f => (
                      <span key={f.id} className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400">
                        {f.code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Specific feeder (optional) */}
              <div>
                <label className="text-[10px] text-mu block mb-1.5">Specific Feeder (optional)</label>
                <select className={inp} value={form.feeder_id}
                  onChange={e => setForm({...form, feeder_id:e.target.value})}>
                  <option value="">All feeders on substation</option>
                  {feederOptions.map(f => (
                    <option key={f.id} value={f.id}>{f.code} — {f.name}</option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div>
                <label className="text-[10px] text-mu block mb-1.5">Shutdown Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[['planned','📅 Planned'],['emergency','🚨 Emergency'],['maintenance','🔧 Maintenance']].map(([val,label]) => (
                    <button key={val} onClick={() => setForm({...form, shutdown_type:val})}
                      className={`py-2.5 rounded-xl border text-xs font-bold transition-all
                        ${form.shutdown_type===val
                          ? val==='emergency' ? 'border-red-500 bg-red-500/15 text-red-400'
                            : val==='maintenance' ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                            : 'border-a bg-a/10 text-a'
                          : 'border-bd text-mu'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] text-mu block mb-1.5">Reason / Description *</label>
                <textarea className={inp} rows={3}
                  placeholder="e.g. Scheduled maintenance of 33kV bus bar. Supply will remain off from 9AM to 2PM."
                  value={form.reason} onChange={e => setForm({...form, reason:e.target.value})} />
              </div>

              {/* Estimated restore */}
              <div>
                <label className="text-[10px] text-mu block mb-1.5">Estimated Restore Time</label>
                <input type="datetime-local" className={inp}
                  value={form.estimated_restore}
                  onChange={e => setForm({...form, estimated_restore:e.target.value})} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={postShutdown} disabled={saving}
                  className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-rajdhani font-bold text-base disabled:opacity-50">
                  {saving ? '⏳ Posting…' : '⚠️ Post Alert to All Users'}
                </button>
                <button onClick={() => setShowForm(false)}
                  className="px-5 py-3.5 rounded-xl border border-bd text-mu font-bold">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
