import { useEffect, useState } from 'react'
import { useAssetStore, useWOStore, useAuthStore, useUIStore } from '../../store/index.js'
import { assetsApi, woApi } from '../../api/client.js'
import { ASSET_TYPES, STATUS_COLORS, fmtOut, outColor, waOpen, buildConsumerNotice } from '../../utils/constants.js'

// ─── Mobile Assets Page ───────────────────────────────────────
export function MobileAssetsPage() {
  const { assets, fetch, update } = useAssetStore()
  const { wos } = useWOStore()
  const { org } = useAuthStore()
  const { toast } = useUIStore()

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)

  useEffect(() => { fetch() }, [])

  const filtered = assets.filter(a => {
    if (filter === 'flagged') return a.status !== 'ok'
    if (filter === 'outstanding') return a.asset_type === 'meter' && (a.outstanding_amount || 0) > 0
    if (filter !== 'all') return a.asset_type === filter
    return true
  }).filter(a => {
    if (!q) return true
    const s = (a.name + (a.details?.consumer_name || '') + (a.details?.k_number || '')).toLowerCase()
    return s.includes(q.toLowerCase())
  }).sort((a, b) => {
    if (filter === 'outstanding') return (b.outstanding_amount||0) - (a.outstanding_amount||0)
    return 0
  })

  async function flag(a) {
    try {
      const ns = a.status === 'flag' ? 'ok' : 'flag'
      const updated = await assetsApi.update(a.id, { status: ns, flag_note: ns==='flag'?'Flagged':null })
      update(a.id, { status: ns, flag_note: updated.flag_note })
      toast(ns==='flag' ? '🚩 Flagged' : '✅ Unflagged', 'ok')
      setModal(m => m ? { ...m, status: ns } : null)
    } catch(e) { toast(e.message, 'err') }
  }

  const CHIPS = [
    { id:'all', label:'All' },
    { id:'meter', label:'🔌 Meters' },
    { id:'dtr', label:'🔆 DTR' },
    { id:'pole', label:'🪧 Poles' },
    { id:'flagged', label:'🚩 Flagged' },
    { id:'outstanding', label:'₹ Outstg' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 pb-0 flex-shrink-0 space-y-2">
        <input placeholder="🔍 Search asset, K.No., consumer…" value={q} onChange={e=>setQ(e.target.value)}
          className="w-full bg-sf border border-bd rounded-2xl px-4 py-3.5 text-base text-tx focus:outline-none focus:border-a" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CHIPS.map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={`flex-shrink-0 text-xs font-bold px-4 py-2 rounded-full border transition-colors
                ${filter===c.id ? 'bg-a text-bg border-a' : 'bg-sf text-mu border-bd'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-mu font-mono px-1">{filtered.length} assets</div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-2 space-y-2">
        {filtered.map(a => {
          const cfg = ASSET_TYPES[a.asset_type]
          const out = a.outstanding_amount || 0
          return (
            <button key={a.id} onClick={() => setModal(a)}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-sf border border-bd active:scale-[0.98] transition-transform text-left">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: cfg?.bg }}>
                {out >= 10000 ? '₹' : cfg?.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base truncate">{a.name}</div>
                <div className="text-sm text-mu mt-0.5 truncate">
                  {cfg?.label}{a.details?.consumer_name ? ' · ' + a.details.consumer_name : ''}
                </div>
                {out > 0 && (
                  <div className="text-sm font-mono font-bold mt-1" style={{ color: outColor(out) }}>
                    ₹{out.toLocaleString('en-IN')}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS[a.status] || '#888' }} />
                {a.status !== 'ok' && <span className="text-[9px] text-amber-400">⚠</span>}
              </div>
            </button>
          )
        })}
      </div>

      {/* Asset Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setModal(null)}>
          <div className="bg-sf rounded-t-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1.5 bg-bd rounded-full mx-auto mt-3 mb-4" />

            <div className="px-5 pb-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                  style={{ background: ASSET_TYPES[modal.asset_type]?.bg }}>
                  {ASSET_TYPES[modal.asset_type]?.icon}
                </div>
                <div>
                  <div className="font-bold text-xl">{modal.name}</div>
                  <div className="text-sm text-mu">{modal.asset_code}</div>
                  {(modal.outstanding_amount||0) > 0 && (
                    <div className="font-mono font-bold text-lg mt-1" style={{ color: outColor(modal.outstanding_amount) }}>
                      ₹{(modal.outstanding_amount||0).toLocaleString('en-IN')}
                    </div>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2 mb-5">
                {Object.entries(modal.details || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2 border-b border-bd/40 text-sm">
                    <span className="text-mu capitalize">{k.replace(/_/g,' ')}</span>
                    <span className="font-medium text-right">{String(v)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-2 border-b border-bd/40 text-sm">
                  <span className="text-mu">GPS</span>
                  <span className="font-mono text-xs">{parseFloat(modal.latitude).toFixed(5)}°N {parseFloat(modal.longitude).toFixed(5)}°E</span>
                </div>
                {modal.survey_accuracy_m && (
                  <div className="flex justify-between py-2 border-b border-bd/40 text-sm">
                    <span className="text-mu">Accuracy</span>
                    <span>±{modal.survey_accuracy_m}m</span>
                  </div>
                )}
              </div>

              {/* Action buttons - large for mobile */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => flag(modal)}
                  className="py-4 rounded-2xl border-2 font-bold text-base transition-colors"
                  style={{ borderColor: modal.status==='flag'?'#10b981':'#f59e0b', color: modal.status==='flag'?'#10b981':'#f59e0b',
                    background: modal.status==='flag'?'rgba(16,185,129,0.1)':'rgba(245,158,11,0.1)' }}>
                  {modal.status==='flag' ? '✅ Unflag' : '🚩 Flag'}
                </button>
                <a href={`https://maps.google.com/?q=${modal.latitude},${modal.longitude}`}
                  target="_blank" rel="noreferrer"
                  className="py-4 rounded-2xl border-2 border-bd bg-bg font-bold text-base text-mu text-center block">
                  📍 Google Maps
                </a>
                {modal.mobile && (
                  <a href={`tel:${modal.mobile}`}
                    className="py-4 rounded-2xl border-2 border-green-500/40 bg-green-500/10 font-bold text-base text-green-400 text-center block">
                    📞 Call Consumer
                  </a>
                )}
                {modal.mobile && (modal.outstanding_amount||0) > 0 && org && (
                  <button onClick={() => { waOpen(buildConsumerNotice(modal, org)); setModal(null) }}
                    className="py-4 rounded-2xl border-2 border-a/30 bg-a/10 font-bold text-base text-a">
                    📱 WA Notice
                  </button>
                )}
              </div>

              <button onClick={() => setModal(null)}
                className="w-full mt-3 py-4 rounded-2xl border border-bd text-mu font-bold text-base">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Mobile Work Orders Page ──────────────────────────────────
export function MobileWOPage() {
  const { wos, fetch, update } = useWOStore()
  const { assets } = useAssetStore()
  const { profile, org } = useAuthStore()
  const { toast } = useUIStore()
  const [filter, setFilter] = useState('open')

  useEffect(() => { fetch() }, [])

  const myWOs = wos.filter(w => {
    if (filter === 'mine') return w.assigned_to_id === profile?.id && w.status !== 'closed'
    if (filter === 'open') return w.status === 'open' || w.status === 'assigned'
    if (filter === 'closed') return w.status === 'closed'
    return true
  })

  const PRIORITY_COLOR = { urgent:'#ef4444', high:'#f97316', normal:'#3b82f6', low:'#6b7280' }
  const STATUS_COL = { open:'#3b82f6', assigned:'#a855f7', closed:'#6b7280' }

  async function closeWO(wo) {
    try {
      const updated = await woApi.close(wo.id, 'Completed in field')
      update(wo.id, updated)
      toast('✅ WO closed', 'ok')
    } catch(e) { toast(e.message, 'err') }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-0 flex-shrink-0">
        <div className="flex gap-2">
          {[['open','Active'],['mine','My WOs'],['closed','Closed']].map(([id,label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`flex-1 py-3 rounded-2xl font-bold text-sm border transition-colors
                ${filter===id ? 'bg-a text-bg border-a' : 'bg-sf text-mu border-bd'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-xs text-mu font-mono px-1 mt-2">{myWOs.length} work orders</div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-2 space-y-3">
        {myWOs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-mu">
            <div className="text-5xl mb-3">🔧</div>
            <div>No work orders</div>
          </div>
        )}
        {myWOs.map(wo => {
          const woAssets = (wo.asset_ids||[]).map(id => assets.find(a=>a.id===id)).filter(Boolean)
          return (
            <div key={wo.id} className="bg-sf border border-bd rounded-2xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-mu">{wo.wo_number}</div>
                  <div className="font-bold text-base mt-0.5">{wo.title}</div>
                  {wo.issue_type && <div className="text-sm text-mu mt-0.5">{wo.issue_type}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
                  <span className="text-xs font-bold px-2 py-1 rounded-full"
                    style={{ background: PRIORITY_COLOR[wo.priority]+'22', color: PRIORITY_COLOR[wo.priority] }}>
                    {wo.priority?.toUpperCase()}
                  </span>
                  <span className="text-xs font-bold px-2 py-1 rounded-full"
                    style={{ background: STATUS_COL[wo.status]+'22', color: STATUS_COL[wo.status] }}>
                    {wo.status?.toUpperCase()}
                  </span>
                </div>
              </div>

              {woAssets.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {woAssets.map(a => (
                    <span key={a.id} className="text-xs px-2 py-1 rounded-full bg-bg border border-bd">
                      {ASSET_TYPES[a.asset_type]?.icon} {a.name}
                    </span>
                  ))}
                </div>
              )}

              {wo.due_date && (
                <div className="text-xs text-mu mb-3">📅 Due: {wo.due_date}</div>
              )}

              {wo.remarks && (
                <div className="text-xs text-mu bg-bg rounded-xl p-2 mb-3">{wo.remarks}</div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {wo.status !== 'closed' && (
                  <button onClick={() => closeWO(wo)}
                    className="py-3.5 rounded-xl border-2 border-green-500/40 bg-green-500/10 text-green-400 font-bold text-sm">
                    ✅ Mark Done
                  </button>
                )}
                {woAssets[0] && (
                  <a href={`https://maps.google.com/?q=${woAssets[0].latitude},${woAssets[0].longitude}`}
                    target="_blank" rel="noreferrer"
                    className="py-3.5 rounded-xl border-2 border-bd bg-bg text-mu font-bold text-sm text-center">
                    📍 Navigate
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
