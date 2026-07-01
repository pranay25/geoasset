import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore } from '../../store/index.js'
import { ROLES } from '../../utils/constants.js'

const TABS = [
  { path: '/m/map',    icon: '🗺️', label: 'MAP'    },
  { path: '/m/survey', icon: '📡', label: 'SURVEY' },
  { path: '/m/assets', icon: '🏗️', label: 'ASSETS' },
  { path: '/m/maintenance', icon: '🔧', label: 'MAINT.' },
  { path: '/m/ta', icon: '🚗', label: 'TA' },
  { path: '/m/shutdown',icon: '⚡', label: 'SHUTDOWN' },
  { path: '/m/patrol',   icon: '🚶', label: 'PATROL'   },
]

export default function MobileShell({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, org, logout } = useAuthStore()
  const { toasts } = useUIStore()
  const role = ROLES[profile?.role]

  function switchToDesktop() {
    localStorage.setItem('geoasset_ui_mode', 'desktop')
    window.location.href = '/'
  }

  return (
    <div className="flex flex-col h-screen bg-bg text-tx overflow-hidden">

      {/* Minimal header */}
      <header className="flex items-center gap-2 px-4 py-3 bg-sf border-b border-bd flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-a to-blue-600 flex items-center justify-center text-sm">⚡</div>
          <div className="min-w-0">
            <div className="font-rajdhani text-a font-bold text-sm leading-none">GeoAsset</div>
            <div className="text-[9px] text-mu leading-none mt-0.5 truncate">{org?.city} · {org?.division}</div>
          </div>
        </div>

        {/* User pill */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-bg border border-bd">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{ background: role?.color + '33', color: role?.color }}>
              {profile?.name?.split(' ').map(n=>n[0]).join('').slice(0,2)}
            </div>
            <span className="text-[10px] font-bold" style={{ color: role?.color }}>{role?.short}</span>
          </div>
          <button onClick={logout}
            className="w-8 h-8 rounded-xl bg-bg border border-bd flex items-center justify-center text-mu text-sm">
            ←
          </button>
        </div>
      </header>

      {/* Main content - full height */}
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>

      {/* Bottom tab bar - large touch targets */}
      <nav className="flex bg-sf border-t border-bd flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tab => {
          const active = location.pathname === tab.path || location.pathname.startsWith(tab.path + '/')
          return (
            <button key={tab.path} onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors relative
                ${active ? 'text-a' : 'text-mu'}`}
              style={{ minHeight: '64px' }}>
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-a rounded-b-full" />}
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[9px] font-rajdhani font-bold tracking-wider">{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Switch to desktop button */}
      <div className="bg-sf border-t border-bd/50 flex justify-center py-1.5 flex-shrink-0">
        <button onClick={switchToDesktop} className="text-[9px] text-mu/50 hover:text-mu transition-colors">
          Switch to Desktop View
        </button>
      </div>

      {/* Toasts */}
      <div className="fixed top-16 left-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-xl text-sm font-semibold shadow-lg border text-center
            ${t.type==='ok'   ? 'bg-green-900/95 border-green-500/30 text-green-300'  : ''}
            ${t.type==='err'  ? 'bg-red-900/95   border-red-500/30   text-red-300'    : ''}
            ${t.type==='warn' ? 'bg-amber-900/95 border-amber-500/30 text-amber-300'  : ''}
            ${t.type==='inf'  ? 'bg-blue-900/95  border-blue-500/30  text-blue-300'   : ''}
          `}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
