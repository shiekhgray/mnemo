import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import Layout from './components/Layout'
import SearchPage from './pages/SearchPage'
import AddPartPage from './pages/AddPartPage'
import ContainersPage from './pages/ContainersPage'
import ContainerPage from './pages/ContainerPage'
import BenchedPage from './pages/BenchedPage'
import LocationsPage from './pages/LocationsPage'

function RequireAuth({ children }) {
  const { loggedIn } = useAuth()
  const location = useLocation()
  if (!loggedIn) {
    const redirect = location.pathname + location.search
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<SearchPage />} />
        <Route path="add" element={<AddPartPage />} />
        <Route path="containers" element={<ContainersPage />} />
        <Route path="containers/:id" element={<ContainerPage />} />
        <Route path="benched" element={<BenchedPage />} />
        <Route path="locations" element={<LocationsPage />} />
      </Route>
    </Routes>
  )
}
