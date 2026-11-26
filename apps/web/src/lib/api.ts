import axios from 'axios'
let refreshPromise: Promise<string> | null = null

// NOTE: no default Content-Type here. axios sets application/json automatically
// for plain-object payloads, and the browser sets multipart/form-data (with
// boundary) when the payload is FormData - a preset header would break both.
const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'X-Renewly-Client': 'browser' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // FastAPI returns {"detail": {"error": {...}}} - normalize for the UI readers.
    const body = error.response?.data
    if (body && typeof body === 'object' && body?.detail?.error?.message) {
      error.response.data = { error: body.detail.error }
    }
    if (['MFA_REQUIRED', 'MFA_INVALID'].includes(error.response?.data?.error?.code)) {
      return Promise.reject(error)
    }
    if (error.response?.status === 401) {
      const config = error.config
      if (localStorage.getItem('access_token') && config && !config._retried && config.url !== '/auth/login' && config.url !== '/auth/refresh') {
        config._retried = true
        try {
          if (!refreshPromise) {
            const renew = async () => {
              const current = localStorage.getItem('access_token')
              if (current && config.headers.Authorization !== `Bearer ${current}`) return current
              const { data } = await axios.post('/api/v1/auth/refresh', {}, { headers: { 'X-Renewly-Client': 'browser' } })
              localStorage.setItem('access_token', data.access_token)
              localStorage.removeItem('refresh_token')
              return data.access_token as string
            }
            refreshPromise = (navigator.locks
              ? navigator.locks.request('renewly-session-refresh', renew)
              : renew()).finally(() => { refreshPromise = null })
          }
          config.headers.Authorization = `Bearer ${await refreshPromise}`
          return api(config)
        } catch { /* Clear an expired or revoked session below. */ }
      }
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api
