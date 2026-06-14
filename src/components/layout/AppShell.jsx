import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore, useAssetStore } from '../../store/index.js'
import { ROLES, fmtOut } from '../../utils/constants.js'

const TABS = [
  { path: '/d/map',       icon: '🗺️',  label: 'MAP'      },
  { path: '/d/survey',    icon: '📡',  label: 'SURVEY'   },
  { path: '/d/assets',    icon: '🏗️', label: 'ASSETS'   },
  { path: '/d/feeders',      icon: '⚡',  label: 'FEEDERS'     },
  { path: '/d/substations', icon: '🏭', label: 'SUBSTATIONS' },
  { path: '/d/maintenance', icon: '🔧', label: 'MAINTENANCE' },
  { path: '/d/export',    icon: '📤',  label: 'EXPORT'   },
  { path: '/d/shutdown',  icon: '⚡',  label: 'SHUTDOWN' },
  { path: '/d/patrol',    icon: '🚶', label: 'PATROL'   },
  { path: '/d/hierarchy', icon: '🏛️', label: 'HIERARCHY', adminOnly: true },
  { path: '/d/audit',     icon: '🔍', label: 'AUDIT LOG', adminOnly: true },
  { path: '/d/sql',       icon: '🛢️', label: 'SQL',      adminOnly: true },
  { path: '/d/users',     icon: '👥',  label: 'USERS',    adminOnly: true },
]

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, org, logout, canManageUsers } = useAuthStore()
  const { toasts } = useUIStore()
  const totalOut = useAssetStore(s => s.totalOutstanding())

  const visibleTabs = TABS.filter(t => !t.adminOnly || canManageUsers())
  // We'll pass activeShutdownCount via a simple window global set by ShutdownAlertModal
  // For now just show the tab
  const role = ROLES[profile?.role]

  return (
    <div className="flex flex-col h-screen bg-bg text-tx overflow-hidden">

      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2 bg-sf border-b border-bd flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-a to-blue-600 flex items-center justify-center text-lg flex-shrink-0">⚡</div>
          <div className="min-w-0">
            <div className="font-rajdhani text-a font-bold text-sm leading-none">GeoAsset</div>
            <div className="text-mu text-[9px] tracking-widest uppercase leading-none mt-0.5 truncate">
              {org?.name} · {org?.division}
            </div>
          </div>
        </div>

        {totalOut > 0 && (
          <button onClick={() => navigate('/assets')}
            className="text-[10px] font-mono font-bold px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-400">
            ₹{fmtOut(totalOut)}
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-sf2 border border-bd">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: role?.color + '33', color: role?.color }}>
              {profile?.name?.split(' ').map(n=>n[0]).join('').slice(0,2)}
            </div>
            <div className="hidden sm:block">
              <div className="text-[11px] font-semibold leading-none">{profile?.name?.split(' ')[0]}</div>
              <div className="text-[9px] text-mu leading-none mt-0.5"
                style={{ color: role?.color }}>{role?.short}</div>
            </div>
          </div>
          <button onClick={()=>{ localStorage.setItem('geoasset_ui_mode','mobile'); window.location.href='/m/map' }}
            className="w-7 h-7 rounded-lg bg-sf2 border border-bd flex items-center justify-center text-mu hover:text-a text-xs" title="Switch to Mobile">
            📱
          </button>
          <button onClick={logout}
            className="w-7 h-7 rounded-lg bg-sf2 border border-bd flex items-center justify-center text-mu hover:text-red-400 text-xs">
            ←
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>

      {/* Tab bar */}
      <nav className="flex bg-sf border-t border-bd flex-shrink-0 safe-area-bottom">
        {visibleTabs.map(tab => {
          const active = location.pathname === tab.path || location.pathname.startsWith(tab.path + '/')
          return (
            <button key={tab.path} onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative
                ${active ? 'text-a' : 'text-mu hover:text-tx'}`}>
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-a rounded-b-full" />}
              <span className="text-base leading-none">{tab.icon}</span>
              <span className="text-[8px] font-rajdhani font-bold tracking-wider leading-none">{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Toasts */}
      <div className="fixed top-16 right-3 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-3 py-2 rounded-xl text-xs font-semibold shadow-lg border
            ${t.type==='ok'  ? 'bg-green-900/90 border-green-500/30 text-green-300'  : ''}
            ${t.type==='err' ? 'bg-red-900/90   border-red-500/30   text-red-300'    : ''}
            ${t.type==='warn'? 'bg-amber-900/90 border-amber-500/30 text-amber-300'  : ''}
            ${t.type==='inf' ? 'bg-blue-900/90  border-blue-500/30  text-blue-300'   : ''}
            ${!['ok','err','warn','inf'].includes(t.type) ? 'bg-sf2 border-bd text-tx' : ''}
          `}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
