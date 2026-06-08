import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/index.js'
import AppShell from './components/layout/AppShell.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SetupPage from './pages/SetupPage.jsx'
import MapPage from './pages/MapPage.jsx'
import SurveyPage from './pages/SurveyPage.jsx'
import { AssetsPage } from './pages/AssetsPage.jsx'
import { FeedersPage } from './pages/FeedersPage.jsx'
import WorkOrdersPage from './pages/WorkOrdersPage.jsx'
import MeasurementBooksPage from './pages/MeasurementBooksPage.jsx'
import UsersPage from './pages/UsersPage.jsx'

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

export default function App() {
  const { init } = useAuthStore()
  useEffect(() => { init() }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/setup"  element={<SetupPage />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <AppShell>
              <Routes>
                <Route path="/"        element={<MapPage />} />
                <Route path="/survey"  element={<SurveyPage />} />
                <Route path="/assets"  element={<AssetsPage />} />
                <Route path="/feeders" element={<FeedersPage />} />
                <Route path="/wo"      element={<WorkOrdersPage />} />
                <Route path="/mb"      element={<MeasurementBooksPage />} />
                <Route path="/users"   element={<UsersPage />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
