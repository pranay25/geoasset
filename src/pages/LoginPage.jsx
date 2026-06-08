import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useUIStore } from '../store/index.js'
import { supabase } from '../api/client.js'

const DEMO_USERS = [
  { label: 'FI',    email: 'fi@demo.geoasset',    pw: 'Demo@1234' },
  { label: 'JE',    email: 'je@demo.geoasset',    pw: 'Demo@1234' },
  { label: 'AO',    email: 'ao@demo.geoasset',    pw: 'Demo@1234' },
  { label: 'SDO',   email: 'sdo@demo.geoasset',   pw: 'Demo@1234' },
  { label: 'Admin', email: 'admin@demo.geoasset',  pw: 'Demo@1234' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const { toast } = useUIStore()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)

  async function doLogin(e) {
    e?.preventDefault()
    if (!email || !pw) return toast('Enter email and password', 'err')
    setLoading(true)
    try {
      await login(email.trim().toLowerCase(), pw)
      navigate('/', { replace: true })
    } catch(err) {
      toast(err.message, 'err')
    } finally { setLoading(false) }
  }

  function quickLogin(u) {
    setEmail(u.email)
    setPw(u.pw)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-a via-blue-500 to-blue-700 flex items-center justify-center text-4xl mx-auto mb-4 shadow-2xl shadow-a/20">⚡</div>
          <div className="font-rajdhani text-a text-3xl font-bold tracking-widest">GeoAsset</div>
          <div className="text-mu text-xs tracking-[3px] uppercase mt-1">Field Asset Management</div>
        </div>

        {/* Form */}
        <div className="bg-sf border border-bd rounded-2xl p-6 shadow-2xl">
          <form onSubmit={doLogin} className="space-y-4">
            <div>
              <label className="text-[10px] text-mu font-bold tracking-widest uppercase block mb-1.5">Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="w-full bg-bg border border-bd rounded-xl px-4 py-3 text-sm text-tx focus:outline-none focus:border-a transition-colors"
                placeholder="employee@org.gov.in" autoComplete="email" />
            </div>
            <div>
              <label className="text-[10px] text-mu font-bold tracking-widest uppercase block mb-1.5">Password</label>
              <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
                className="w-full bg-bg border border-bd rounded-xl px-4 py-3 text-sm text-tx focus:outline-none focus:border-a transition-colors"
                placeholder="••••••••" autoComplete="current-password" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-a to-blue-500 text-bg font-rajdhani font-bold text-base tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? '⏳ Signing in…' : '🔐 Login'}
            </button>
          </form>

          {/* Quick login */}
          <div className="mt-5">
            <div className="text-[9px] text-mu tracking-widest uppercase text-center mb-2">Quick Login (Demo)</div>
            <div className="flex gap-2">
              {DEMO_USERS.map(u => (
                <button key={u.label} onClick={() => quickLogin(u)}
                  className="flex-1 py-1.5 rounded-lg bg-sf2 border border-bd text-[10px] font-bold text-mu hover:text-a hover:border-a/50 transition-colors">
                  {u.label}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-mu text-center mt-2">Password: Demo@1234</div>
          </div>
        </div>

        <div className="text-center mt-4">
          <button onClick={() => navigate('/setup')} className="text-[10px] text-mu hover:text-a underline transition-colors">
            First time? Setup organisation →
          </button>
        </div>
      </div>
    </div>
  )
}
