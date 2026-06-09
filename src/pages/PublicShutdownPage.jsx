import { useEffect, useRef, useState } from 'react'
import { supabase, shutdownApi } from '../api/client.js'

const TYPE_CONFIG = {
  planned:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  icon: '📅', label: 'Planned Shutdown'      },
  emergency:   { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: '🚨', label: 'Emergency Shutdown'    },
  maintenance: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: '🔧', label: 'Maintenance Shutdown'  },
}

export default function PublicShutdownPage() {
  const [location, setLocation] = useState(null)
  const [locError, setLocError] = useState(null)
  const [locating, setLocating] = useState(false)
  const [shutdowns, setShutdowns] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [radius, setRadius] = useState(15)
  const channelRef = useRef(null)

  useEffect(() => {
    getLocation()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [])

  useEffect(() => {
    if (location) {
      fetchNearby()
      subscribeRealtime()
    }
  }, [location, radius])

  function getLocation() {
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported by your browser')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
        setLocating(false)
      },
      err => {
        setLocError('Could not get your location. Please allow location access and refresh.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  }

  async function fetchNearby() {
    if (!location) return
    setLoading(true)
    try {
      const data = await shutdownApi.getNearby(location.lat, location.lng, radius)
      setShutdowns(data)
      setLastRefresh(new Date())
    } catch(e) {
      console.error('Fetch nearby:', e)
    } finally { setLoading(false) }
  }

  function subscribeRealtime() {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    // Subscribe to all shutdown changes — filter client-side by distance
    channelRef.current = supabase.channel('public-shutdowns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shutdowns' },
        () => fetchNearby()  // refetch on any change
      )
      .subscribe()
  }

  function fmtTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts)
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000)
    if (h === 0) return `${m} min ago`
    return `${h}h ${m}m ago`
  }

  function timeTill(ts) {
    if (!ts) return null
    const diff = new Date(ts) - Date.now()
    if (diff <= 0) return 'Overdue'
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000)
    if (h === 0) return `~${m} min`
    return `~${h}h ${m}m`
  }

  const active   = shutdowns.filter(s => s.status === 'active')
  const restored = shutdowns.filter(s => s.status === 'restored')

  return (
    <div className="min-h-screen bg-bg text-tx" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="bg-sf border-b border-bd sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-a to-blue-600 flex items-center justify-center text-xl flex-shrink-0">⚡</div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-a leading-none" style={{ fontFamily:'system-ui' }}>
              Power Outage Board
            </div>
            <div className="text-[10px] text-mu mt-0.5">Live updates · No login required</div>
          </div>
          <button onClick={fetchNearby} disabled={loading || !location}
            className="w-8 h-8 rounded-xl border border-bd flex items-center justify-center text-mu text-sm disabled:opacity-40">
            {loading ? <span className="animate-spin">◌</span> : '↻'}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Location status */}
        {locating && (
          <div className="bg-sf border border-bd rounded-2xl p-4 text-center">
            <div className="text-2xl mb-2 animate-pulse">📍</div>
            <div className="text-sm text-mu">Getting your location…</div>
          </div>
        )}

        {locError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <div className="text-sm font-bold text-red-400 mb-2">📵 Location Error</div>
            <div className="text-xs text-red-300">{locError}</div>
            <button onClick={getLocation}
              className="mt-3 w-full py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-bold">
              Try Again
            </button>
          </div>
        )}

        {location && !locating && (
          <div className="bg-sf border border-bd rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-xs text-green-400 font-bold">Location Active</span>
              </div>
              <div className="text-[10px] text-mu font-mono">
                ±{Math.round(location.acc || 0)}m accuracy
              </div>
            </div>
            <div className="font-mono text-[10px] text-mu mb-3">
              {location.lat.toFixed(4)}°N · {location.lng.toFixed(4)}°E
            </div>
            {/* Radius selector */}
            <div>
              <div className="text-[10px] text-mu mb-2">Search radius: <span className="text-a font-bold">{radius} km</span></div>
              <div className="flex gap-2">
                {[5, 10, 15, 25, 50].map(r => (
                  <button key={r} onClick={() => setRadius(r)}
                    className={`flex-1 py-1.5 rounded-xl border text-[10px] font-bold transition-colors
                      ${radius===r ? 'bg-a text-bg border-a' : 'border-bd text-mu'}`}>
                    {r}km
                  </button>
                ))}
              </div>
            </div>
            {lastRefresh && (
              <div className="text-[9px] text-mu text-right mt-2">
                Last updated: {lastRefresh.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}
              </div>
            )}
          </div>
        )}

        {/* Active shutdowns */}
        {location && !loading && (
          <>
            {active.length === 0 && restored.length === 0 && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 text-center">
                <div className="text-4xl mb-3">✅</div>
                <div className="font-bold text-green-400 text-base">No Active Outages</div>
                <div className="text-mu text-sm mt-1">
                  No power outages within {radius}km of your location
                </div>
                <div className="text-[10px] text-mu mt-3">
                  Updates automatically · Pull to refresh
                </div>
              </div>
            )}

            {active.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  <span className="font-bold text-sm text-red-400">{active.length} ACTIVE OUTAGE{active.length>1?'S':''}</span>
                </div>
                <div className="space-y-3">
                  {active.map(sd => {
                    const tc = TYPE_CONFIG[sd.shutdown_type] || TYPE_CONFIG.planned
                    const till = timeTill(sd.estimated_restore)
                    return (
                      <div key={sd.id} className="rounded-2xl overflow-hidden border-2 border-red-500/50"
                        style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.2)' }}>
                        {/* Alert header */}
                        <div className="bg-red-500/15 px-4 py-3 flex items-center gap-3">
                          <span className="text-2xl">{tc.icon}</span>
                          <div className="flex-1">
                            <div className="font-bold text-red-400 text-sm">{tc.label.toUpperCase()}</div>
                            <div className="text-[10px] text-mu">{timeAgo(sd.start_time)}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-sm text-amber-400">{sd.distance_km}km</div>
                            <div className="text-[9px] text-mu">away</div>
                          </div>
                        </div>

                        <div className="bg-sf p-4 space-y-3">
                          {/* Substation */}
                          <div>
                            <div className="text-[10px] text-mu uppercase tracking-wider mb-0.5">Substation</div>
                            <div className="font-bold text-lg">🏭 {sd.substation_name}</div>
                            {sd.org_name && <div className="text-xs text-mu">{sd.org_name} · {sd.division}</div>}
                          </div>

                          {/* Reason */}
                          <div className="bg-bg rounded-xl p-3 text-sm text-tx leading-relaxed">
                            {sd.reason}
                          </div>

                          {/* Times */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-bg rounded-xl p-3">
                              <div className="text-[10px] text-mu mb-1">Outage Started</div>
                              <div className="font-mono text-xs font-bold">{fmtTime(sd.start_time)}</div>
                            </div>
                            <div className="bg-bg rounded-xl p-3">
                              <div className="text-[10px] text-mu mb-1">
                                Est. Restore {till && <span className="text-amber-400 ml-1">{till}</span>}
                              </div>
                              <div className="font-mono text-xs font-bold text-amber-400">
                                {sd.estimated_restore ? fmtTime(sd.estimated_restore) : 'Not specified'}
                              </div>
                            </div>
                          </div>

                          {/* Posted by */}
                          <div className="flex items-center justify-between text-[10px] text-mu">
                            <span>Reported by: {sd.posted_by || 'System'}</span>
                            {sd.city && <span>📍 {sd.city}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recently restored */}
            {restored.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="font-bold text-sm text-green-400">
                    {restored.length} RECENTLY RESTORED
                  </span>
                </div>
                <div className="space-y-2">
                  {restored.slice(0, 5).map(sd => (
                    <div key={sd.id} className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xl">✅</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-green-400">{sd.substation_name}</div>
                          <div className="text-[10px] text-mu">{sd.org_name}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-mono text-sm font-bold text-green-400">{sd.distance_km}km</div>
                          <div className="text-[9px] text-mu">away</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="bg-bg/50 rounded-lg p-2">
                          <div className="text-mu">Was down since</div>
                          <div className="font-mono font-bold">{fmtTime(sd.start_time)}</div>
                        </div>
                        <div className="bg-bg/50 rounded-lg p-2">
                          <div className="text-mu">Restored at</div>
                          <div className="font-mono font-bold text-green-400">{fmtTime(sd.actual_restore)}</div>
                        </div>
                      </div>
                      {sd.restore_note && (
                        <div className="mt-2 text-xs text-green-300 bg-green-500/10 rounded-lg p-2">
                          📝 {sd.restore_note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Info footer */}
        <div className="text-center py-4 space-y-2">
          <div className="text-[10px] text-mu leading-relaxed">
            This board updates automatically in real-time.<br/>
            Showing shutdowns within {radius}km of your current location.
          </div>
          <div className="text-[9px] text-mu/50">Powered by GeoAsset · Power Distribution Management</div>
        </div>
      </div>
    </div>
  )
}
