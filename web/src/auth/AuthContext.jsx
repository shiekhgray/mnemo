import { createContext, useContext, useState } from 'react'
import axios from 'axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(
    () => !!localStorage.getItem('access_token')
  )
  const [username, setUsername] = useState(
    () => localStorage.getItem('username') ?? ''
  )

  async function login(user, password) {
    const params = new URLSearchParams({ username: user, password })
    const { data } = await axios.post('/mnemo/api/auth/login', params)
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('username', user)
    setUsername(user)
    setLoggedIn(true)
  }

  function logout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('username')
    setUsername('')
    setLoggedIn(false)
  }

  return (
    <AuthContext.Provider value={{ loggedIn, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
