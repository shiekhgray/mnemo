import axios from 'axios'

const api = axios.create({ baseURL: '/mnemo/api' })

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mnemo_access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Wipe the session and bounce to login — only for a *genuine* auth failure (the
// refresh token itself is invalid/expired), never for a transient network blip.
function hardLogout() {
  localStorage.removeItem('mnemo_access_token')
  localStorage.removeItem('mnemo_refresh_token')
  if (!window.location.pathname.endsWith('/login')) {
    window.location.href = '/mnemo/login'
  }
}

// Single-flight token refresh: concurrent 401s (e.g. a burst of refetches on phone
// refocus) share one in-flight refresh instead of each firing their own. Resolves to
// the new access token, or rejects.
//
// We deliberately distinguish *why* a refresh fails:
//   - a 401 from /auth/refresh means the refresh token is truly dead → log out.
//   - anything else (offline, timeout, 5xx) is transient → reject WITHOUT clearing
//     tokens, so the still-valid session survives a flaky connection. This is the fix
//     for "I keep getting logged out out of the blue."
let refreshPromise = null

function refreshAccessToken() {
  if (!refreshPromise) {
    const refresh = localStorage.getItem('mnemo_refresh_token')
    if (!refresh) return Promise.reject({ sessionDead: true })
    refreshPromise = axios
      .post('/mnemo/api/auth/refresh', { refresh_token: refresh })
      .then(({ data }) => {
        localStorage.setItem('mnemo_access_token', data.access_token)
        return data.access_token
      })
      .catch((err) => {
        // Re-throw with a flag so callers can tell a dead session from a hiccup.
        throw { sessionDead: err.response?.status === 401, cause: err }
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// On 401, try to refresh once and replay the request.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error)
    }
    original._retry = true
    try {
      const token = await refreshAccessToken()
      original.headers.Authorization = `Bearer ${token}`
      return api(original)
    } catch (refreshErr) {
      // Only nuke the session when the refresh token is genuinely invalid. A
      // transient failure leaves tokens intact so the next request can retry.
      if (refreshErr?.sessionDead) hardLogout()
      return Promise.reject(error)
    }
  }
)

export default api
