import { useEffect, useState, useRef } from 'react'
import { useAuthStore, useFeederStore } from '../store/index.js'
import { shutdownApi } from '../api/client.js'

export default function ShutdownAlertModal() {
  const { profile, org } = useAuthStore()
  const { feeders } = useFeederStore()
  const [alerts, setAlerts] = useState([])       // unacknowledged active shutdowns
  const [current, setCurrent] = useState(0)      // index of alert being shown
  const channelRef = useRef(null)

  useEffect(() => {
    if (!profile?.org_id) return

    // Load existing active shutdowns on mount
    loadActive()

    // Subscribe to real-time new shutdowns
    const orgId = profile.org_id
    channelRef.current = shutdownApi.subscribe(
      orgId,
      // onInsert — new shutdown posted
      (newShutdown) => {
        if (!isAcked(newShutdown) && isRelevant(newShutdown)) {
          setAlerts(prev => {
            if (prev.find(a => a.id === newShutdown.id)) return prev
            return [...prev, newShutdown]
          })
        }
      },
      // onUpdate — restoration or acknowledge
      (updated) => {
        if (updated.status === 'restored') {
          // Show restoration alert
          setAlerts(prev => prev.map(a =>
            a.id === updated.id ? { ...a, ...updated, _justRestored: true } : a
          ))
        } else {
          setAlerts(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
        }
      }
    )

    return () => { shutdownApi.unsubscribe(channelRef.current) }
  }, [profile?.org_id])

  async function loadActive() {
    try {
      const active = await shutdownApi.listActive()
      const relevant = active.filter(sd => !isAcked(sd) && isRelevant(sd))
      setAlerts(relevant)
    } catch(e) { console.warn('Load active shutdowns:', e) }
  }

  function isAcked(sd) {
    return (sd.acknowledged_by || []).includes(profile?.id)
  }

  // Only show shutdown if relevant to this user's scope
  function isRelevant(sd) {
    if (!profile) return false
    const role = profile.role
    // Circle/division level — see all shutdowns in org
    if (['admin','se','ee','ao'].includes(role)) return true
    // SDO — sees shutdowns where their subdivision is involved
    // substation.subdivision_id must match profile.subdivision_id
    // We use sd.substation_id indirectly — if feeder belongs to their subdivision
    if (role === 'sdo' && profile.subdivision_id) {
      // affected_feeders contains feeder IDs — SDO's feeders are in their subdivision
      // For now show if any feeder in affected_feeders OR substation matches
      return true // SDO gets all — further filtered by RLS org_id
    }
    // JE — only their substation
    if (role === 'je' && profile.substation_id) {
      return sd.substation_id === profile.substation_id
    }
    // FI — only if their specific feeder is affected
    if (role === 'feeder_incharge' && profile.feeder_id) {
      return (sd.affected_feeders || []).includes(profile.feeder_id)
    }
    return false
  }


  async function acknowledge(sd) {
    try {
      await shutdownApi.acknowledge(sd.id, profile?.id)
      // If last alert or restored, remove from list
      setAlerts(prev => prev.filter(a => a.id !== sd.id))
      setCurrent(0)
    } catch(e) { console.warn('Ack failed:', e) }
  }

  if (alerts.length === 0) return null

  const alert = alerts[current]
  if (!alert) return null

  const isRestored = alert.status === 'restored' || alert._justRestored
  const affectedCodes = (alert.affected_feeders || [])
    .map(id => {
      const f = feeders.find(f => f.id === id)
      return f ? { code: f.code, name: f.name } : null
    }).filter(Boolean)

  function fmtTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
  }

  const TYPE_CONFIG = {
    planned:     { color:'#3b82f6', label:'Planned Shutdown'     },
    emergency:   { color:'#ef4444', label:'Emergency Shutdown'   },
    maintenance: { color:'#f59e0b', label:'Maintenance Shutdown' },
  }
  const tc = TYPE_CONFIG[alert.shutdown_type] || TYPE_CONFIG.planned

  return (
    <>
      {/* Full screen dark overlay */}
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className={`w-full max-w-sm rounded-3xl border-2 overflow-hidden shadow-2xl
          ${isRestored ? 'border-green-500/60' : alert.shutdown_type==='emergency' ? 'border-red-500/80' : 'border-amber-500/60'}`}
          style={{ boxShadow: isRestored
            ? '0 0 60px rgba(34,197,94,0.3)'
            : alert.shutdown_type==='emergency'
              ? '0 0 60px rgba(239,68,68,0.4)'
              : '0 0 60px rgba(245,158,11,0.3)' }}>

          {/* Alert header */}
          <div className={`px-5 py-4 flex items-center gap-3
            ${isRestored ? 'bg-green-500/20' : alert.shutdown_type==='emergency' ? 'bg-red-500/20' : 'bg-amber-500/15'}`}>
            <div className="text-4xl">
              {isRestored ? '✅' : alert.shutdown_type==='emergency' ? '🚨' : '⚠️'}
            </div>
            <div className="flex-1">
              <div className={`font-rajdhani font-bold text-lg leading-tight
                ${isRestored ? 'text-green-400' : alert.shutdown_type==='emergency' ? 'text-red-400' : 'text-amber-400'}`}>
                {isRestored ? 'SUPPLY RESTORED' : tc.label.toUpperCase()}
              </div>
              <div className="text-[10px] text-mu mt-0.5">
                {isRestored ? 'Power supply has been restored' : 'Power supply interrupted'}
              </div>
            </div>
            {/* Multiple alerts indicator */}
            {alerts.length > 1 && (
              <div className="text-xs font-mono font-bold text-mu bg-bg/50 px-2 py-1 rounded-lg">
                {current+1}/{alerts.length}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="bg-sf p-5 space-y-4">
            {/* Substation */}
            <div className="text-center">
              <div className="text-mu text-[10px] tracking-widest uppercase mb-1">Substation</div>
              <div className="font-rajdhani font-bold text-2xl text-tx">🏭 {alert.substation_name}</div>
            </div>

            {/* Reason */}
            <div className="bg-bg rounded-2xl p-4 text-sm text-tx leading-relaxed">
              {alert.reason}
            </div>

            {/* Time info */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-bg rounded-xl p-3">
                <div className="text-mu mb-1">{isRestored ? 'Went Down' : 'Shut Down At'}</div>
                <div className="font-mono font-bold">{fmtTime(alert.start_time)}</div>
              </div>
              {isRestored ? (
                <div className="bg-green-500/10 rounded-xl p-3 border border-green-500/20">
                  <div className="text-mu mb-1">Restored At</div>
                  <div className="font-mono font-bold text-green-400">{fmtTime(alert.actual_restore)}</div>
                </div>
              ) : (
                <div className="bg-bg rounded-xl p-3">
                  <div className="text-mu mb-1">Est. Restore</div>
                  <div className="font-mono font-bold text-amber-400">
                    {alert.estimated_restore ? fmtTime(alert.estimated_restore) : 'Not specified'}
                  </div>
                </div>
              )}
            </div>

            {/* Affected feeders */}
            {affectedCodes.length > 0 && (
              <div>
                <div className="text-[10px] text-mu mb-2">
                  {isRestored ? '✅ Restored Feeders' : '⚡ Affected Feeders'} ({affectedCodes.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {affectedCodes.map(({ code, name }) => (
                    <div key={code}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border"
                      style={{
                        background: isRestored ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        borderColor: isRestored ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
                      }}>
                      <span className="text-xs font-mono font-bold"
                        style={{ color: isRestored ? '#4ade80' : '#f87171' }}>
                        ⚡ {code}
                      </span>
                      {name && <span className="text-[10px] text-mu">— {name}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Restore note */}
            {isRestored && alert.restore_note && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-xs text-green-300">
                📝 {alert.restore_note}
              </div>
            )}

            {/* Posted by */}
            <div className="text-[10px] text-mu text-center">
              Posted by {alert.profiles?.name || 'System'} · {fmtTime(alert.created_at)}
            </div>

            {/* Acknowledge button */}
            <button onClick={() => acknowledge(alert)}
              className={`w-full py-4 rounded-2xl font-rajdhani font-bold text-lg tracking-wider text-bg
                ${isRestored
                  ? 'bg-gradient-to-r from-green-500 to-green-600'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600'}`}>
              {isRestored ? '✅ Acknowledged — Supply Restored' : '✅ I Acknowledge This Alert'}
            </button>

            {/* Next alert button */}
            {alerts.length > 1 && (
              <button onClick={() => setCurrent(c => (c+1) % alerts.length)}
                className="w-full py-2 rounded-xl border border-bd text-mu text-xs">
                View next alert ({alerts.length - current - 1} more)
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
