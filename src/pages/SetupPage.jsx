import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../store/index.js'
import { authApi } from '../api/client.js'
import { INDIAN_STATES } from '../utils/constants.js'

export default function SetupPage() {
  const navigate = useNavigate()
  const { toast } = useUIStore()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const [org, setOrg] = useState({
    name: '', circle: '', division: '', city: '', state: 'Rajasthan',
    lat: '', lng: '',
    subdivisions: [{ code: 'SD-01', name: 'Sub-Division 1' }],
  })
  const [admin, setAdmin] = useState({
    name: '', email: '', mobile: '', employeeId: '', password: '', confirm: '',
  })

  function addSubdiv() {
    setOrg(o => ({ ...o, subdivisions: [...o.subdivisions, { code: '', name: '' }] }))
  }
  function updateSubdiv(i, field, val) {
    setOrg(o => {
      const subs = [...o.subdivisions]
      subs[i] = { ...subs[i], [field]: val }
      return { ...o, subdivisions: subs }
    })
  }
  function removeSubdiv(i) {
    setOrg(o => ({ ...o, subdivisions: o.subdivisions.filter((_,j)=>j!==i) }))
  }

  async function doSetup() {
    if (!org.name || !org.division || !org.city) return toast('Fill in organisation details', 'err')
    if (!org.subdivisions.some(s=>s.code&&s.name)) return toast('Add at least one subdivision', 'err')
    if (!admin.name || !admin.email || !admin.employeeId) return toast('Fill in admin user details', 'err')
    if (!admin.password || admin.password.length < 8) return toast('Password must be 8+ characters', 'err')
    if (admin.password !== admin.confirm) return toast('Passwords do not match', 'err')

    setLoading(true)
    try {
      await authApi.setup({
        org: { ...org, lat: parseFloat(org.lat)||24.5963, lng: parseFloat(org.lng)||76.169,
          subdivisions: org.subdivisions.filter(s=>s.code&&s.name) },
        adminUser: admin,
      })
      toast('✅ Setup complete! Please login.', 'ok')
      setTimeout(() => navigate('/login'), 1500)
    } catch(err) {
      toast(err.message, 'err')
    } finally { setLoading(false) }
  }

  const inp = "w-full bg-bg border border-bd rounded-xl px-4 py-3 text-sm text-tx focus:outline-none focus:border-a transition-colors"
  const lbl = "text-[10px] text-mu font-bold tracking-widest uppercase block mb-1.5"

  return (
    <div className="min-h-screen bg-bg p-4 pb-10">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8 pt-6">
          <div className="text-5xl mb-3">⚡</div>
          <div className="font-rajdhani text-a text-2xl font-bold">GeoAsset Setup</div>
          <div className="text-mu text-xs mt-1">Configure once · Deploy everywhere</div>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 mb-6">
          {[1,2].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${step>=s ? 'bg-a' : 'bg-bd'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="bg-sf border border-bd rounded-2xl p-5">
              <div className="text-a font-rajdhani font-bold text-sm tracking-wider mb-4">🏢 ORGANISATION</div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={lbl}>Discom / Organisation *</label>
                  <input className={inp} placeholder="JVVNL, AVVNL, PVVNL…"
                    value={org.name} onChange={e=>setOrg({...org,name:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>Circle / Zone</label>
                  <input className={inp} placeholder="Kota Circle"
                    value={org.circle} onChange={e=>setOrg({...org,circle:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>Division *</label>
                  <input className={inp} placeholder="Jhalawar Division"
                    value={org.division} onChange={e=>setOrg({...org,division:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>City *</label>
                  <input className={inp} placeholder="Jhalawar"
                    value={org.city} onChange={e=>setOrg({...org,city:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>State</label>
                  <select className={inp} value={org.state} onChange={e=>setOrg({...org,state:e.target.value})}>
                    {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <div className={lbl}>📍 Default Map Centre (from Google Maps)</div>
                <div className="text-[10px] text-mu mb-2">Open Google Maps → your office → long press → copy coordinates</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Latitude (°N)</label>
                    <input type="number" className={inp} placeholder="24.5963" step="0.0001"
                      value={org.lat} onChange={e=>setOrg({...org,lat:e.target.value})} />
                  </div>
                  <div>
                    <label className={lbl}>Longitude (°E)</label>
                    <input type="number" className={inp} placeholder="76.1690" step="0.0001"
                      value={org.lng} onChange={e=>setOrg({...org,lng:e.target.value})} />
                  </div>
                </div>
              </div>
            </div>

            {/* Subdivisions */}
            <div className="bg-sf border border-bd rounded-2xl p-5">
              <div className="text-a font-rajdhani font-bold text-sm tracking-wider mb-4">🏗️ SUBDIVISIONS</div>
              {org.subdivisions.map((sd, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr_32px] gap-2 mb-2">
                  <input className={inp + ' text-xs'} placeholder="SD-01"
                    value={sd.code} onChange={e=>updateSubdiv(i,'code',e.target.value.toUpperCase())} />
                  <input className={inp + ' text-xs'} placeholder="Subdivision Name"
                    value={sd.name} onChange={e=>updateSubdiv(i,'name',e.target.value)} />
                  <button onClick={()=>removeSubdiv(i)}
                    className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20">✕</button>
                </div>
              ))}
              <button onClick={addSubdiv}
                className="w-full mt-2 py-2 rounded-xl border border-dashed border-bd text-mu text-xs hover:border-a hover:text-a transition-colors">
                + Add Subdivision
              </button>
            </div>

            <button onClick={()=>setStep(2)}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-base tracking-widest">
              Next → Admin User
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-sf border border-bd rounded-2xl p-5">
              <div className="text-a font-rajdhani font-bold text-sm tracking-wider mb-4">👤 ADMIN USER</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={lbl}>Full Name *</label>
                  <input className={inp} placeholder="Admin Name"
                    value={admin.name} onChange={e=>setAdmin({...admin,name:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>Employee ID *</label>
                  <input className={inp} placeholder="EMP-001" style={{textTransform:'uppercase'}}
                    value={admin.employeeId} onChange={e=>setAdmin({...admin,employeeId:e.target.value.toUpperCase()})} />
                </div>
                <div>
                  <label className={lbl}>Mobile</label>
                  <input type="tel" className={inp} placeholder="9414500001"
                    value={admin.mobile} onChange={e=>setAdmin({...admin,mobile:e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className={lbl}>Email (Login ID) *</label>
                  <input type="email" className={inp} placeholder="admin@jvvnl.gov.in"
                    value={admin.email} onChange={e=>setAdmin({...admin,email:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>Password *</label>
                  <input type="password" className={inp} placeholder="Min 8 chars"
                    value={admin.password} onChange={e=>setAdmin({...admin,password:e.target.value})} />
                </div>
                <div>
                  <label className={lbl}>Confirm *</label>
                  <input type="password" className={inp} placeholder="Re-enter"
                    value={admin.confirm} onChange={e=>setAdmin({...admin,confirm:e.target.value})} />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={()=>setStep(1)}
                className="flex-1 py-3 rounded-xl border border-bd text-mu font-rajdhani font-bold">
                ← Back
              </button>
              <button onClick={doSetup} disabled={loading}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-sm tracking-wider disabled:opacity-50">
                {loading ? '⏳ Setting up…' : '✅ Create & Start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
