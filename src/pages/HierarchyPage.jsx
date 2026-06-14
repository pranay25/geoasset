import { useEffect, useState } from 'react'
import { useAuthStore, useUIStore } from '../store/index.js'
import { hierarchyApi } from '../api/client.js'

export default function HierarchyPage() {
  const { org, profile, isAdmin } = useAuthStore()
  const { toast } = useUIStore()

  const [divisions, setDivisions] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDiv, setExpandedDiv] = useState(null)

  // Form state
  const [divForm, setDivForm] = useState(null)   // null | { _new, id, name, code, city, lat, lng }
  const [subForm, setSubForm] = useState(null)   // null | { _new, id, division_id, code, name }
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const data = await hierarchyApi.listDivisions()
      setDivisions(data || [])
      if (data?.length > 0 && !expandedDiv) setExpandedDiv(data[0].id)
    } catch(e) {
      console.error('Hierarchy load error:', e)
      // Don't toast on load — just show empty state
    }
    finally { setLoading(false) }
  }

  async function saveDivision() {
    if (!divForm.name) return toast('Division name required', 'err')
    setSaving(true)
    try {
      if (divForm._new) {
        const d = await hierarchyApi.createDivision({
          name: divForm.name, code: divForm.code, city: divForm.city,
          lat: parseFloat(divForm.lat)||null, lng: parseFloat(divForm.lng)||null,
        })
        setDivisions(prev => [...prev, { ...d, subdivisions: [] }])
        setExpandedDiv(d.id)
        toast('✅ Division created', 'ok')
      } else {
        const d = await hierarchyApi.updateDivision(divForm.id, {
          name: divForm.name, code: divForm.code, city: divForm.city,
          lat: parseFloat(divForm.lat)||null, lng: parseFloat(divForm.lng)||null,
        })
        setDivisions(prev => prev.map(x => x.id===d.id ? { ...x, ...d } : x))
        toast('✅ Division updated', 'ok')
      }
      setDivForm(null)
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function deleteDivision(div) {
    if (!confirm(`Delete division "${div.name}"? This cannot be undone.`)) return
    try {
      await hierarchyApi.deleteDivision(div.id)
      setDivisions(prev => prev.filter(d => d.id !== div.id))
      toast('🗑 Division deleted', 'ok')
    } catch(e) { toast(e.message, 'err') }
  }

  async function saveSubdivision() {
    if (!subForm.code || !subForm.name) return toast('Code and name required', 'err')
    setSaving(true)
    try {
      if (subForm._new) {
        const s = await hierarchyApi.createSubdivision({
          code: subForm.code.toUpperCase(),
          name: subForm.name,
          division_id: subForm.division_id,
        })
        setDivisions(prev => prev.map(d =>
          d.id === subForm.division_id
            ? { ...d, subdivisions: [...(d.subdivisions||[]), s] }
            : d
        ))
        toast('✅ Sub-Division created', 'ok')
      } else {
        const s = await hierarchyApi.updateSubdivision(subForm.id, {
          code: subForm.code.toUpperCase(), name: subForm.name,
        })
        setDivisions(prev => prev.map(d => ({
          ...d,
          subdivisions: (d.subdivisions||[]).map(x => x.id===s.id ? s : x)
        })))
        toast('✅ Sub-Division updated', 'ok')
      }
      setSubForm(null)
    } catch(e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function deleteSubdivision(sub, divId) {
    if (!confirm(`Delete sub-division "${sub.name}"?`)) return
    try {
      await hierarchyApi.deleteSubdivision(sub.id)
      setDivisions(prev => prev.map(d =>
        d.id === divId
          ? { ...d, subdivisions: (d.subdivisions||[]).filter(s => s.id !== sub.id) }
          : d
      ))
      toast('🗑 Sub-Division deleted', 'ok')
    } catch(e) { toast(e.message, 'err') }
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  if (profile?.role !== 'admin') return (
    <div className="h-full flex items-center justify-center text-mu">
      <div className="text-center"><div className="text-4xl mb-3">🚫</div><div>Admin access only</div></div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2 flex-shrink-0 border-b border-bd">
        {/* Circle (read-only, one per org) */}
        <div className="flex items-center gap-3 mb-4 p-3 bg-sf2 border border-a/20 rounded-2xl">
          <div className="w-10 h-10 rounded-xl bg-a/10 border border-a/20 flex items-center justify-center text-xl">🔵</div>
          <div className="flex-1">
            <div className="text-[10px] text-mu tracking-widest uppercase">Circle</div>
            <div className="font-rajdhani font-bold text-base text-a">{org?.circle || org?.name}</div>
            <div className="text-[10px] text-mu">{org?.state}</div>
          </div>
          <div className="text-[9px] text-mu border border-bd rounded-lg px-2 py-1">1 Circle per Org</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="font-rajdhani font-bold text-sm text-tx">
            Divisions ({divisions.length})
          </div>
          <button onClick={() => setDivForm({ _new:true, name:'', code:'', city:'', lat:'', lng:'' })}
            className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
            + New Division
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-center text-mu py-8 text-sm animate-pulse">Loading…</div>}

        {divisions.map(div => (
          <div key={div.id} className="bg-sf border border-bd rounded-2xl overflow-hidden">
            {/* Division row */}
            <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-sf2 transition-colors"
              onClick={() => setExpandedDiv(expandedDiv===div.id ? null : div.id)}>
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-base flex-shrink-0">
                🏛️
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{div.name}</div>
                <div className="text-[10px] text-mu mt-0.5 flex gap-2">
                  {div.code && <span>{div.code}</span>}
                  {div.city && <span>📍 {div.city}</span>}
                  <span>{(div.subdivisions||[]).length} sub-divisions</span>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); setDivForm({ id:div.id, name:div.name, code:div.code||'', city:div.city||'', lat:div.lat||'', lng:div.lng||'' }) }}
                  className="w-8 h-8 rounded-lg border border-bd flex items-center justify-center text-mu text-xs hover:border-a hover:text-a">✏️</button>
                <button onClick={e => { e.stopPropagation(); deleteDivision(div) }}
                  className="w-8 h-8 rounded-lg border border-red-500/30 flex items-center justify-center text-red-400 text-xs">🗑</button>
                <div className="w-8 h-8 flex items-center justify-center text-mu text-xs">
                  {expandedDiv===div.id ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {/* Subdivisions */}
            {expandedDiv === div.id && (
              <div className="border-t border-bd">
                {(div.subdivisions||[]).map(sub => (
                  <div key={sub.id} className="flex items-center gap-3 px-4 py-3 border-b border-bd/50 hover:bg-sf2/50 transition-colors">
                    <div className="w-1 h-8 rounded-full bg-a/30 ml-2 flex-shrink-0" />
                    <div className="w-8 h-8 rounded-lg bg-a/10 border border-a/20 flex items-center justify-center text-sm flex-shrink-0">
                      🏗️
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{sub.name}</div>
                      <div className="text-[10px] font-mono text-a">{sub.code}</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => setSubForm({ id:sub.id, division_id:div.id, code:sub.code, name:sub.name })}
                        className="w-7 h-7 rounded-lg border border-bd flex items-center justify-center text-mu text-[10px] hover:border-a hover:text-a">✏️</button>
                      <button onClick={() => deleteSubdivision(sub, div.id)}
                        className="w-7 h-7 rounded-lg border border-red-500/30 flex items-center justify-center text-red-400 text-[10px]">🗑</button>
                    </div>
                  </div>
                ))}

                {/* Add subdivision button */}
                <button onClick={() => setSubForm({ _new:true, division_id:div.id, code:'', name:'' })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sf2/50 transition-colors text-mu">
                  <div className="w-1 h-6 rounded-full bg-bd ml-2 flex-shrink-0" />
                  <div className="w-8 h-8 rounded-lg border border-dashed border-bd flex items-center justify-center text-lg">+</div>
                  <span className="text-xs font-bold">Add Sub-Division to {div.name}</span>
                </button>
              </div>
            )}
          </div>
        ))}

        {!loading && divisions.length === 0 && (
          <div className="text-center py-12 text-mu">
            <div className="text-4xl mb-3">🏛️</div>
            <div className="text-sm">No divisions yet</div>
            <div className="text-xs mt-1">Create your first division above</div>
          </div>
        )}
      </div>

      {/* Division Form Modal */}
      {divForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setDivForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">
              {divForm._new ? '🏛️ New Division' : '✏️ Edit Division'}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-mu block mb-1">Division Name *</label>
                <input className={inp} placeholder="e.g. Jhalawar Division"
                  value={divForm.name} onChange={e => setDivForm({...divForm, name:e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Code</label>
                  <input className={inp} placeholder="DIV-01"
                    value={divForm.code} onChange={e => setDivForm({...divForm, code:e.target.value.toUpperCase()})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">City / HQ</label>
                  <input className={inp} placeholder="Jhalawar"
                    value={divForm.city} onChange={e => setDivForm({...divForm, city:e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Latitude</label>
                  <input type="number" className={inp} placeholder="24.5963" step="0.0001"
                    value={divForm.lat} onChange={e => setDivForm({...divForm, lat:e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Longitude</label>
                  <input type="number" className={inp} placeholder="76.1690" step="0.0001"
                    value={divForm.lng} onChange={e => setDivForm({...divForm, lng:e.target.value})} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={saveDivision} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving ? '⏳…' : '💾 Save Division'}
                </button>
                <button onClick={() => setDivForm(null)}
                  className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Division Form Modal */}
      {subForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setSubForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">
              {subForm._new ? '🏗️ New Sub-Division' : '✏️ Edit Sub-Division'}
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Code *</label>
                  <input className={inp} placeholder="SD-03"
                    value={subForm.code} onChange={e => setSubForm({...subForm, code:e.target.value.toUpperCase()})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Name *</label>
                  <input className={inp} placeholder="SD-03 Jhalawar"
                    value={subForm.name} onChange={e => setSubForm({...subForm, name:e.target.value})} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={saveSubdivision} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving ? '⏳…' : '💾 Save Sub-Division'}
                </button>
                <button onClick={() => setSubForm(null)}
                  className="px-6 py-3 rounded-xl border border-bd text-mu font-bold">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
