/**
 * The only platform-specific piece: how HTTP requests are made and how the
 * session token is attached/refreshed. Web passes an axios-backed transport
 * (cookie refresh); a React Native app passes a fetch-backed one that keeps
 * the refresh token in SecureStore. Everything above this is shared.
 */
export type QueryParams = Record<string, string | number | boolean | null | undefined>
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  params?: QueryParams
  body?: unknown
  form?: FormData
  responseType?: 'json' | 'blob'
}

export interface Transport {
  request<T>(method: Method, path: string, options?: RequestOptions): Promise<T>
}

export interface TokenStore {
  getAccess(): Promise<string | null> | string | null
  setAccess(token: string | null): Promise<void> | void
  getRefresh(): Promise<string | null> | string | null
  setRefresh(token: string | null): Promise<void> | void
}

/** A fetch transport with bearer + refresh-token rotation (mobile, scripts, tests). */
export function createFetchTransport(baseUrl: string, tokens: TokenStore, fetchImpl: typeof fetch = fetch): Transport {
  let refreshing: Promise<string | null> | null = null
  const refresh = async () => {
    const rt = await tokens.getRefresh()
    if (!rt) return null
    const r = await fetchImpl(`${baseUrl}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) })
    if (!r.ok) { await tokens.setAccess(null); await tokens.setRefresh(null); return null }
    const data = (await r.json()) as { access_token: string; refresh_token?: string }
    await tokens.setAccess(data.access_token)
    if (data.refresh_token) await tokens.setRefresh(data.refresh_token)
    return data.access_token as string
  }
  const send = async (method: Method, path: string, o: RequestOptions, token: string | null) => {
    const qs = o.params ? '?' + new URLSearchParams(Object.entries(o.params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)] as [string, string])).toString() : ''
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let body: BodyInit | undefined
    if (o.form) body = o.form
    else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body) }
    return fetchImpl(`${baseUrl}${path}${qs}`, { method, headers, body })
  }
  return {
    async request<T>(method: Method, path: string, o: RequestOptions = {}): Promise<T> {
      let res = await send(method, path, o, await tokens.getAccess())
      if (res.status === 401) {
        refreshing ??= refresh().finally(() => { refreshing = null })
        const fresh = await refreshing
        if (fresh) res = await send(method, path, o, fresh)
      }
      if (!res.ok) throw await ApiError.from(res)
      if (res.status === 204) return undefined as T
      return (o.responseType === 'blob' ? res.blob() : res.json()) as Promise<T>
    },
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }

  static async from(res: Response) {
    let message = res.statusText || 'Request failed', code: string | undefined
    try {
      const body = (await res.json()) as { detail?: { error?: { message?: string; code?: string } } | { msg: string }[] | string; error?: { message?: string; code?: string } }
      const detail = body?.detail
      const err = (detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.error : undefined) ?? body?.error
      if (err?.message) { message = err.message; code = err.code }
      else if (Array.isArray(detail)) message = detail.map((d) => d.msg).join('; ')
      else if (typeof detail === 'string') message = detail
    } catch { /* non-JSON error body */ }
    return new ApiError(message, res.status, code)
  }
}

/** Human-readable message from any thrown API error (axios or ApiError). */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) return err.message
  const e = err as { response?: { data?: { error?: { message?: string }; detail?: unknown } }; message?: string }
  const data = e?.response?.data
  if (data?.error?.message) return data.error.message
  if (Array.isArray(data?.detail)) return (data!.detail as { msg: string }[]).map((d) => d.msg.replace(/^Value error, /, '')).join('; ')
  if (typeof data?.detail === 'string') return data.detail
  return e?.message || fallback
}
