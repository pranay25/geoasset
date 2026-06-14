import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/index.js'

// Shared pages
import LoginPage from './pages/LoginPage.jsx'
import SetupPage from './pages/SetupPage.jsx'
import DeviceSelectPage from './pages/DeviceSelectPage.jsx'

// Desktop pages
import AppShell from './components/layout/AppShell.jsx'
import MapPage from './pages/MapPage.jsx'
import SurveyPage from './pages/SurveyPage.jsx'
import { AssetsPage } from './pages/AssetsPage.jsx'
import { FeedersPage } from './pages/FeedersPage.jsx'
import MaintenancePage from './pages/MaintenancePage.jsx'
// WorkOrdersPage and MeasurementBooksPage removed — replaced by MaintenancePage
import UsersPage from './pages/UsersPage.jsx'
import HierarchyPage from './pages/HierarchyPage.jsx'
import AuditLogPage from './pages/AuditLogPage.jsx'
import ShutdownPage from './pages/ShutdownPage.jsx'
import PatrolPage from './pages/PatrolPage.jsx'
import SQLEditorPage from './pages/SQLEditorPage.jsx'
import SubstationsPage from './pages/SubstationsPage.jsx'
import PublicShutdownPage from './pages/PublicShutdownPage.jsx'
import ShutdownAlertModal from './components/ShutdownAlertModal.jsx'
import ExportPage from './pages/ExportPage.jsx'

// Mobile pages
import MobileShell from './components/mobile/MobileShell.jsx'
import MobileMapPage from './pages/mobile/MobileMapPage.jsx'
import MobileSurveyPage from './pages/mobile/MobileSurveyPage.jsx'
import { MobileAssetsPage, MobileWOPage } from './pages/mobile/MobilePages.jsx'

function getUIMode() {
  return localStorage.getItem('geoasset_ui_mode') // 'mobile' | 'desktop' | null
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="text-center">
        <div className="text-5xl mb-4">⚡</div>
        <div className="text-a font-rajdhani text-xl font-bold tracking-widest">GEOASSET</div>
        <div className="text-mu text-xs mt-2 animate-pulse">Loading…</div>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RootRedirect() {
  const mode = getUIMode()
  if (!mode) return <Navigate to="/device" replace />
  if (mode === 'mobile') return <Navigate to="/m/map" replace />
  return <Navigate to="/d/map" replace />
}

export default function App() {
  const { init } = useAuthStore()
  useEffect(() => { init() }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/setup"  element={<SetupPage />} />
        <Route path="/device" element={<ProtectedRoute><DeviceSelectPage /></ProtectedRoute>} />

        {/* Public — no auth needed */}
        <Route path="/outages" element={<PublicShutdownPage />} />

        {/* Root redirect */}
        <Route path="/" element={<ProtectedRoute><RootRedirect /></ProtectedRoute>} />

        {/* ── Desktop routes ── */}
        <Route path="/d/*" element={
          <ProtectedRoute>
            <>
            <ShutdownAlertModal />
            <AppShell>
              <Routes>
                <Route path="map"    element={<MapPage />} />
                <Route path="survey" element={<SurveyPage />} />
                <Route path="assets" element={<AssetsPage />} />
                <Route path="feeders"element={<FeedersPage />} />
                <Route path="maintenance" element={<MaintenancePage />} />
                <Route path="users"     element={<UsersPage />} />
                <Route path="hierarchy" element={<HierarchyPage />} />
                <Route path="audit"     element={<AuditLogPage />} />
                <Route path="shutdown"  element={<ShutdownPage />} />
                <Route path="patrol"    element={<PatrolPage />} />
                <Route path="sql"       element={<SQLEditorPage />} />
                <Route path="substations" element={<SubstationsPage />} />
                <Route path="export"    element={<ExportPage />} />
                <Route path="*"         element={<Navigate to="/d/map" replace />} />
              </Routes>
            </AppShell>
            </>
          </ProtectedRoute>
        } />

        {/* ── Mobile routes ── */}
        <Route path="/m/*" element={
          <ProtectedRoute>
            <>
            <ShutdownAlertModal />
            <MobileShell>
              <Routes>
                <Route path="map"    element={<MobileMapPage />} />
                <Route path="survey" element={<MobileSurveyPage />} />
                <Route path="assets" element={<MobileAssetsPage />} />
                <Route path="maintenance" element={<MaintenancePage />} />
                <Route path="shutdown" element={<ShutdownPage />} />
                <Route path="patrol"    element={<PatrolPage />} />
                <Route path="*"      element={<Navigate to="/m/map" replace />} />
              </Routes>
            </MobileShell>
            </>
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
