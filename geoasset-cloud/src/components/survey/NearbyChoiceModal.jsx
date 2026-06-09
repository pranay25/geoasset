import { useState } from 'react'
import { ASSET_TYPES } from '../../utils/constants.js'

/**
 * Shown when user tries to survey at a location with existing assets nearby.
 * Correct logic:
 *   - User may be adding a COMPLETELY NEW asset type (no conflict — proceed freely)
 *   - OR user wants to UPDATE one specific existing asset (replace only that one)
 *   - NEVER delete all nearby assets blindly
 */
export default function NearbyChoiceModal({ nearby, pendingPayload: pp, onCancel, onProceed, auditApi }) {
  const [choice, setChoice] = useState('new')  // 'new' | asset_id
  const chosenAsset = choice !== 'new' ? nearby.find(a => a.id === choice) : null

  function proceed() {
    if (choice === 'new') {
      // Add new asset — no deletion
      onProceed([])
    } else {
      // Replace only the specifically chosen asset
      auditApi?.log({
        action: 'RESURVEY', category: 'survey', severity: 'warn',
        description: `Asset ${chosenAsset?.asset_code || choice} resurveyed — replaced by user choice`,
        meta: { replaced_id: choice, asset_code: chosenAsset?.asset_code, nearby_count: nearby.length },
      })
      onProceed([choice])
    }
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      {/* Header */}
      <div className="text-center py-4 mb-4 flex-shrink-0">
        <div className="text-5xl mb-3">ℹ️</div>
        <div className="font-rajdhani font-bold text-xl text-a">Assets Already Here</div>
        <div className="text-mu text-sm mt-1">
          {nearby.length} asset{nearby.length > 1 ? 's' : ''} already surveyed within 20m
        </div>
      </div>

      {/* Existing assets — info only */}
      <div className="bg-sf border border-bd rounded-2xl p-3 mb-4 flex-shrink-0">
        <div className="text-[10px] text-mu font-bold tracking-wider mb-2">NEARBY ASSETS</div>
        {nearby.map(a => {
          const cfg = ASSET_TYPES[a.asset_type]
          return (
            <div key={a.id} className="flex items-center gap-3 py-2 border-b border-bd/40 last:border-0">
              <span className="text-xl flex-shrink-0">{cfg?.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{a.name}</div>
                <div className="text-[10px] text-mu">{cfg?.label} · {a.asset_code}</div>
                <div className="font-mono text-[10px] text-a">
                  {parseFloat(a.latitude).toFixed(5)}°N · {parseFloat(a.longitude).toFixed(5)}°E
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-mono font-bold text-base text-amber-400">{a.distance_m}m</div>
                <div className="text-[9px] text-mu">away</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Question */}
      <div className="font-rajdhani font-bold text-sm text-tx mb-3 flex-shrink-0">
        What are you surveying at this location?
      </div>

      {/* Choices */}
      <div className="space-y-2 flex-1">
        {/* New asset */}
        <button onClick={() => setChoice('new')}
          className={`w-full p-4 rounded-2xl border-2 text-left transition-all
            ${choice === 'new' ? 'border-a bg-a/10' : 'border-bd bg-sf hover:border-bd2'}`}>
          <div className={`font-bold text-base ${choice==='new'?'text-a':'text-tx'}`}>
            ✨ A different / new asset
          </div>
          <div className="text-xs text-mu mt-1">
            e.g. surveying a meter near an existing pole — both will exist independently. No data deleted.
          </div>
        </button>

        {/* Update specific existing asset */}
        {nearby.map(a => {
          const cfg = ASSET_TYPES[a.asset_type]
          const isChosen = choice === a.id
          return (
            <button key={a.id} onClick={() => setChoice(a.id)}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all
                ${isChosen ? 'border-amber-500 bg-amber-500/10' : 'border-bd bg-sf hover:border-bd2'}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl flex-shrink-0">{cfg?.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-base ${isChosen?'text-amber-400':'text-tx'}`}>
                    🔄 Re-survey: {a.name}
                  </div>
                  <div className="text-xs text-mu mt-0.5">
                    {cfg?.label} · {a.asset_code} · {a.distance_m}m away
                  </div>
                  {isChosen && (
                    <div className="text-[10px] text-red-400 mt-1.5 bg-red-500/10 rounded-lg px-2 py-1">
                      ⚠️ Only this asset's data will be replaced. Others untouched.
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 pt-4 flex-shrink-0">
        <button onClick={onCancel}
          className="px-5 py-3.5 rounded-2xl border border-bd text-mu font-rajdhani font-bold text-sm">
          ← Cancel
        </button>
        <button onClick={proceed}
          className="flex-1 py-3.5 rounded-2xl font-rajdhani font-bold text-base transition-all"
          style={{
            background: choice === 'new'
              ? 'linear-gradient(135deg,#00d4ff,#3b82f6)'
              : 'linear-gradient(135deg,#f59e0b,#f97316)',
            color: '#07101e'
          }}>
          {choice === 'new' ? '✨ Add New Asset' : `🔄 Replace ${chosenAsset?.name || 'Asset'}`}
        </button>
      </div>
    </div>
  )
}
