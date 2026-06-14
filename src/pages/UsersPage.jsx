import { useEffect, useState } from 'react'
import { useUserStore, useAuthStore, useUIStore, useSubstationStore, useFeederStore } from '../store/index.js'
import { usersApi, auditApi } from '../api/client.js'
import { hierarchyApi } from '../api/client.js'
import { ROLES } from '../utils/constants.js'

// Role scope determines what fields to show in user form
const ROLE_SCOPE = {
  admin:           { label: 'Circle-wide access',       fields: []                                         },
  se:              { label: 'Circle-wide access',        fields: []                                         },
  ee:              { label: 'Division-wide access',      fields: ['division']                               },
  ao:              { label: 'Circle-wide access',        fields: []                                         },
  sdo:             { label: 'Sub-Division access',       fields: ['division','subdivision']                 },
  je:              { label: 'Sub-Station access',        fields: ['division','subdivision','substation']    },
  feeder_incharge: { label: 'Feeder-level access',       fields: ['division','subdivision','substation','feeder'] },
}

export default function UsersPage() {
  const { users, fetch, add, update } = useUserStore()
  const { substations, fetch: fetchSubstations } = useSubstationStore()
  const { feeders, fetch: fetchFeeders } = useFeederStore()
  const { profile: me, isAdmin } = useAuthStore()
  const { toast } = useUIStore()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [divisions, setDivisions] = useState([])
  const [subdivisions, setSubdivisions] = useState([])

  useEffect(() => {
    fetch()
    fetchSubstations()
    fetchFeeders()
    hierarchyApi.listDivisions().then(setDivisions).catch(()=>{})
  }, [])

  // When division changes in form, filter subdivisions
  useEffect(() => {
    if (!form?.division_id) { setSubdivisions([]); return }
    const div = divisions.find(d => d.id === form.division_id)
    setSubdivisions(div?.subdivisions || [])
  }, [form?.division_id, divisions])

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2.5 text-sm text-tx focus:outline-none focus:border-a"

  const ROLE_OPTIONS = Object.entries(ROLES).map(([k,v]) => ({ value: k, label: v.label }))

  function openNew() {
    setForm({
      _new: true, name: '', employee_id: '', email: '', mobile: '',
      role: 'feeder_incharge', password: '', confirm: '',
      division_id: '', subdivision_id: '', substation_id: '', feeder_id: '',
    })
  }

  function openEdit(u) {
    setForm({
      _id: u.id, name: u.name, employee_id: u.employee_id,
      mobile: u.mobile||'', role: u.role,
      division_id: u.division_id||'',
      subdivision_id: u.subdivision_id||'',
      substation_id: u.substation_id||'',
      feeder_id: u.feeder_id||'',
    })
  }

  async function save() {
    if (!form.name || !form.employee_id) return toast('Name and Employee ID required','err')
    if (form._new && (!form.email || !form.password)) return toast('Email and password required','err')
    if (form._new && form.password !== form.confirm) return toast('Passwords do not match','err')
    if (form._new && form.password?.length < 8) return toast('Password min 8 chars','err')

    const scope = ROLE_SCOPE[form.role]
    if (scope?.fields.includes('division') && !form.division_id)
      return toast('Select division for this role','err')
    if (scope?.fields.includes('subdivision') && !form.subdivision_id)
      return toast('Select sub-division for this role','err')
    if (scope?.fields.includes('substation') && !form.substation_id)
      return toast('Select sub-station for this role','err')
    if (scope?.fields.includes('feeder') && !form.feeder_id)
      return toast('Select feeder for this role','err')

    setSaving(true)
    try {
      if (form._new) {
        const newUser = await usersApi.create({
          email: form.email, password: form.password,
          name: form.name,
          employee_id: form.employee_id.toUpperCase(),
          mobile: form.mobile || null,
          role: form.role,
          division_id: form.division_id || null,
          subdivision_id: form.subdivision_id || null,
          substation_id: form.substation_id || null,
          feeder_id: form.feeder_id || null,
        })
        add(newUser)
        try { await auditApi.log({ action:'USER_CREATED', category:'user', severity:'info',
          description:`User ${form.employee_id} (${form.name}) created as ${form.role}`,
          meta: { employee_id:form.employee_id, role:form.role } }) } catch {}
        toast(`✅ ${form.name} created`, 'ok')
      } else {
        const updated = await usersApi.update(form._id, {
          name: form.name, mobile: form.mobile, role: form.role,
          division_id: form.division_id || null,
          subdivision_id: form.subdivision_id || null,
          substation_id: form.substation_id || null,
          feeder_id: form.feeder_id || null,
        })
        update(form._id, updated)
        toast('✅ User updated', 'ok')
      }
      setForm(null)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  async function toggleActive(u) {
    try {
      const updated = await usersApi.toggleActive(u.id)
      update(u.id, updated)
      try { await auditApi.log({ action: updated.is_active?'USER_ACTIVATED':'USER_DEACTIVATED',
        category:'user', severity: updated.is_active?'info':'warn',
        description:`User ${u.employee_id} (${u.name}) ${updated.is_active?'activated':'deactivated'}`,
        meta: { employee_id:u.employee_id } }) } catch {}
      toast(`${updated.is_active?'✅ Activated':'🚫 Deactivated'}: ${u.name}`, 'ok')
    } catch(e) { toast(e.message,'err') }
  }

  const filtered = users.filter(u => {
    if (filter === 'all') return true
    if (filter === 'inactive') return !u.is_active
    return u.role === filter
  })

  const scope = form ? ROLE_SCOPE[form.role] : null

  // Feeders for selected substation
  const substationFeeders = form?.substation_id
    ? feeders.filter(f => f.substation_id === form.substation_id)
    : feeders

  // Only admin can access Users page
  if (me?.role !== 'admin') return (
    <div className="h-full flex items-center justify-center text-mu">
      <div className="text-center"><div className="text-4xl mb-3">🔐</div><div className="text-sm">Admin access only</div></div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 flex-shrink-0 flex items-center justify-between border-b border-bd">
        <div>
          <div className="font-rajdhani font-bold text-sm text-tx">👥 Users</div>
          <div className="text-[10px] text-mu mt-0.5">{users.length} staff accounts</div>
        </div>
        {isAdmin() && (
          <button onClick={openNew}
            className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">
            + New User
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 flex gap-1.5 overflow-x-auto flex-shrink-0 border-b border-bd/50">
        {[
          ['all','All'],
          ...Object.entries(ROLES).map(([k,v]) => [k, v.short]),
          ['inactive','Inactive'],
        ].map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors
              ${filter===id ? 'bg-a text-bg border-a' : 'border-bd text-mu'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.map(u => {
          const role = ROLES[u.role]
          const scopeLabel = ROLE_SCOPE[u.role]?.label
          const scopeDetail = u.role === 'feeder_incharge'
            ? feeders.find(f=>f.id===u.feeder_id)?.code
            : u.role === 'je'
              ? substations.find(s=>s.id===u.substation_id)?.name
              : u.role === 'sdo'
                ? subdivisions.find ? null : null  // simplified
                : null

          return (
            <div key={u.id}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors
                ${u.id===me?.id ? 'bg-a/5 border-a/30' : 'bg-sf border-bd'}`}>
              {/* Avatar */}
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: (role?.bg||'rgba(99,99,99,0.15)'), color: role?.color }}>
                {u.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{u.name}</span>
                  {u.id===me?.id && <span className="text-[9px] text-mu">(you)</span>}
                  {!u.is_active && <span className="text-[9px] text-red-400">INACTIVE</span>}
                </div>
                <div className="text-[10px] text-mu font-mono">{u.employee_id}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: role?.bg, color: role?.color }}>{role?.short}</span>
                  <span className="text-[9px] text-mu">{scopeLabel}</span>
                </div>
              </div>
              {isAdmin() && u.id !== me?.id && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(u)}
                    className="w-8 h-8 rounded-xl border border-bd text-mu text-xs flex items-center justify-center hover:border-a hover:text-a">✏️</button>
                  <button onClick={() => toggleActive(u)}
                    className={`w-8 h-8 rounded-xl border text-xs flex items-center justify-center
                      ${u.is_active ? 'border-red-500/30 text-red-400' : 'border-green-500/30 text-green-400'}`}>
                    {u.is_active ? '🚫' : '✅'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* User Form Modal */}
      {form && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">
              {form._new ? '👤 New User' : '✏️ Edit User'}
            </div>

            <div className="space-y-3">
              {/* Basic info */}
              <div>
                <label className="text-[10px] text-mu block mb-1">Full Name *</label>
                <input className={inp} placeholder="Ramesh Kumar Sharma"
                  value={form.name} onChange={e => setForm({...form, name:e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mu block mb-1">Employee ID *</label>
                  <input className={inp} placeholder="JE-1042"
                    value={form.employee_id} onChange={e => setForm({...form, employee_id:e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] text-mu block mb-1">Mobile</label>
                  <input className={inp} placeholder="9414511001" type="tel"
                    value={form.mobile} onChange={e => setForm({...form, mobile:e.target.value})} />
                </div>
              </div>

              {/* Role selection — full width with description */}
              <div>
                <label className="text-[10px] text-mu block mb-1">Role *</label>
                <select className={inp} value={form.role}
                  onChange={e => setForm({...form, role:e.target.value, division_id:'', subdivision_id:'', substation_id:'', feeder_id:''})}>
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {scope && (
                  <div className="mt-1 text-[10px] px-2 py-1 rounded-lg"
                    style={{ background: ROLES[form.role]?.bg, color: ROLES[form.role]?.color }}>
                    🔒 {scope.label}
                  </div>
                )}
              </div>

              {/* Scope fields — shown based on role */}
              {scope?.fields.includes('division') && (
                <div>
                  <label className="text-[10px] text-mu block mb-1">Division *</label>
                  <select className={inp} value={form.division_id}
                    onChange={e => setForm({...form, division_id:e.target.value, subdivision_id:'', substation_id:'', feeder_id:''})}>
                    <option value="">Select division…</option>
                    {divisions.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
                  </select>
                </div>
              )}

              {scope?.fields.includes('subdivision') && form.division_id && (
                <div>
                  <label className="text-[10px] text-mu block mb-1">Sub-Division *</label>
                  <select className={inp} value={form.subdivision_id}
                    onChange={e => setForm({...form, subdivision_id:e.target.value, substation_id:'', feeder_id:''})}>
                    <option value="">Select sub-division…</option>
                    {subdivisions.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                  </select>
                </div>
              )}

              {scope?.fields.includes('substation') && form.subdivision_id && (
                <div>
                  <label className="text-[10px] text-mu block mb-1">Sub-Station *</label>
                  <select className={inp} value={form.substation_id}
                    onChange={e => setForm({...form, substation_id:e.target.value, feeder_id:''})}>
                    <option value="">Select sub-station…</option>
                    {substations.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                  </select>
                </div>
              )}

              {scope?.fields.includes('feeder') && form.substation_id && (
                <div>
                  <label className="text-[10px] text-mu block mb-1">Feeder *</label>
                  <select className={inp} value={form.feeder_id}
                    onChange={e => setForm({...form, feeder_id:e.target.value})}>
                    <option value="">Select feeder…</option>
                    {substationFeeders.map(f => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
                  </select>
                </div>
              )}

              {/* Login credentials — only for new users */}
              {form._new && (
                <>
                  <div>
                    <label className="text-[10px] text-mu block mb-1">Email (Login) *</label>
                    <input className={inp} placeholder="je.ramesh@jvvnl.com" type="email"
                      value={form.email} onChange={e => setForm({...form, email:e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-mu block mb-1">Password *</label>
                      <input className={inp} type="password" placeholder="Min 8 chars"
                        value={form.password} onChange={e => setForm({...form, password:e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] text-mu block mb-1">Confirm *</label>
                      <input className={inp} type="password"
                        value={form.confirm} onChange={e => setForm({...form, confirm:e.target.value})} />
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={save} disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving ? '⏳…' : form._new ? '👤 Create User' : '💾 Save Changes'}
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
