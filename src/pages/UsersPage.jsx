import { useEffect, useState } from 'react'
import { useUserStore, useAuthStore, useUIStore } from '../store/index.js'
import { usersApi } from '../api/client.js'
import { ROLES } from '../utils/constants.js'

export default function UsersPage() {
  const { users, fetch, update } = useUserStore()
  const { profile, org, isAdmin } = useAuthStore()
  const { toast } = useUIStore()

  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetch() }, [])

  const inp = "w-full bg-bg border border-bd rounded-xl px-3 py-2 text-sm text-tx focus:outline-none focus:border-a"

  const filtered = users.filter(u => {
    if (filter==='inactive') return !u.is_active
    if (filter!=='all') return u.role===filter
    return true
  })

  async function toggleActive(u) {
    try {
      const updated = await usersApi.toggleActive(u.id)
      update(u.id, updated)
      toast(`${updated.is_active?'✅ Activated':'🚫 Deactivated'}: ${u.name}`, 'ok')
    } catch(e) { toast(e.message,'err') }
  }

  async function save() {
    if (!form.name||!form.employee_id) return toast('Name and Employee ID required','err')
    if (form._new && (!form.email||!form.password)) return toast('Email and password required for new user','err')
    if (form._new && form.password!==form.confirm) return toast('Passwords do not match','err')
    if (form._new && form.password?.length<8) return toast('Password min 8 chars','err')
    setSaving(true)
    try {
      if (form._new) {
        await usersApi.create({ email:form.email, password:form.password, name:form.name,
          employee_id:form.employee_id.toUpperCase(), mobile:form.mobile, role:form.role,
          subdivision_id:form.subdivision_id||null })
        await fetch()
        toast(`✅ User ${form.employee_id} created`,'ok')
      } else {
        const { _new, _id, ...updates } = form
        const updated = await usersApi.update(form._id, { name:updates.name, mobile:updates.mobile, role:updates.role })
        update(form._id, updated)
        toast('✅ User updated','ok')
      }
      setForm(null)
    } catch(e) { toast(e.message,'err') } finally { setSaving(false) }
  }

  const CHIPS = [
    {id:'all',label:'All'},
    ...Object.entries(ROLES).map(([id,{short}])=>({id,label:short})),
    {id:'inactive',label:'🚫 Inactive'},
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 pb-0 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-rajdhani font-bold text-sm">Users</div>
          <button onClick={()=>setForm({_new:true,name:'',employee_id:'',email:'',mobile:'',role:'feeder_incharge',password:'',confirm:''})}
            className="px-3 py-2 rounded-xl bg-a/10 border border-a/30 text-a text-xs font-bold">+ New User</button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {CHIPS.map(c=>(
            <button key={c.id} onClick={()=>setFilter(c.id)}
              className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition-colors
                ${filter===c.id?'bg-a text-bg border-a':'bg-sf text-mu border-bd'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
        {filtered.map(u => {
          const role = ROLES[u.role]
          const initials = u.name.split(' ').map(n=>n[0]).join('').slice(0,2)
          const isMe = u.id===profile?.id
          return (
            <div key={u.id} className={`flex items-center gap-3 p-3 rounded-xl mb-2 border transition-colors bg-sf
              ${!u.is_active?'opacity-50':''} border-bd hover:border-bd2`}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{background:role?.color+'33',color:role?.color}}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{u.name}</span>
                  {isMe&&<span className="text-[9px] text-a">(you)</span>}
                  {!u.is_active&&<span className="text-[9px] text-red-400">INACTIVE</span>}
                </div>
                <div className="text-[10px] text-mu mt-0.5 font-mono">{u.employee_id}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{background:role?.bg,color:role?.color}}>
                    {role?.short}
                  </span>
                  {u.subdivisions&&<span className="text-[9px] text-mu">{u.subdivisions.code}</span>}
                  {u.mobile&&<span className="text-[9px] text-mu">📱 {u.mobile}</span>}
                </div>
              </div>
              {!isMe&&(
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={()=>setForm({_id:u.id,name:u.name,employee_id:u.employee_id,mobile:u.mobile||'',role:u.role})}
                    className="px-2 py-1 rounded-lg border border-bd text-mu text-[10px]">✏️</button>
                  <button onClick={()=>toggleActive(u)}
                    className={`px-2 py-1 rounded-lg border text-[10px] ${u.is_active?'border-amber-500/30 text-amber-400':'border-green-500/30 text-green-400'}`}>
                    {u.is_active?'🚫':'✅'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={()=>setForm(null)}>
          <div className="w-full bg-sf border-t border-bd rounded-t-2xl p-4 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-bd rounded-full mx-auto mb-4" />
            <div className="font-rajdhani font-bold text-a mb-4">{form._new?'👤 New User':'✏️ Edit User'}</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="text-[10px] text-mu block mb-1">Full Name *</label>
                  <input className={inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
                <div><label className="text-[10px] text-mu block mb-1">Employee ID *</label>
                  <input className={inp} disabled={!form._new} style={{textTransform:'uppercase'}}
                    value={form.employee_id} onChange={e=>setForm({...form,employee_id:e.target.value.toUpperCase()})} /></div>
                <div><label className="text-[10px] text-mu block mb-1">Role</label>
                  <select className={inp} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                    {Object.entries(ROLES).map(([id,{label}])=><option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div><label className="text-[10px] text-mu block mb-1">Mobile</label>
                  <input type="tel" className={inp} value={form.mobile||''} onChange={e=>setForm({...form,mobile:e.target.value})} /></div>
              </div>

              {form._new&&(
                <>
                  <div><label className="text-[10px] text-mu block mb-1">Email (Login) *</label>
                    <input type="email" className={inp} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] text-mu block mb-1">Password *</label>
                      <input type="password" className={inp} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></div>
                    <div><label className="text-[10px] text-mu block mb-1">Confirm *</label>
                      <input type="password" className={inp} value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})} /></div>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold disabled:opacity-50">
                  {saving?'⏳…':(form._new?'👤 Create':'✅ Save')}
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
