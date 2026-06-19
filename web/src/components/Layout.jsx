import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function Layout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <span className="brand">Mnemo</span>
        <button className="link-btn" onClick={handleLogout}>Sign out</button>
      </header>

      <main className="main-content">
        <Outlet />
      </main>

      <nav className="tab-bar">
        <NavLink to="/" end>Search</NavLink>
        <NavLink to="/add">Add</NavLink>
        <NavLink to="/containers">Containers</NavLink>
        <NavLink to="/benched">Benched</NavLink>
      </nav>
    </div>
  )
}
