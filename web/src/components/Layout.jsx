import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

export default function Layout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [changingPassword, setChangingPassword] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <span className="brand">Mnemo</span>
        <div className="top-bar-actions">
          <button className="link-btn" onClick={() => setChangingPassword(true)}>Change password</button>
          <button className="link-btn" onClick={handleLogout}>Sign out</button>
        </div>
      </header>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}

      <main className="main-content">
        <Outlet />
      </main>

      <nav className="tab-bar">
        <NavLink to="/" end>Search</NavLink>
        <NavLink to="/add">Add</NavLink>
        <NavLink to="/locations">Locations</NavLink>
        <NavLink to="/containers">Containers</NavLink>
        <NavLink to="/benched">Benched</NavLink>
      </nav>
    </div>
  )
}
