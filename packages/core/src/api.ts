import type { QueryParams, Transport } from './transport'
import type * as T from './types'

/** Typed endpoint map shared by every client. */
export function createApi(t: Transport) {
  const get = <R>(p: string, params?: QueryParams) => t.request<R>('GET', p, { params })
  const post = <R>(p: string, body?: unknown) => t.request<R>('POST', p, { body: body ?? {} })
  const put = <R>(p: string, body?: unknown) => t.request<R>('PUT', p, { body })
  const patch = <R>(p: string, body?: unknown) => t.request<R>('PATCH', p, { body })
  const del = (p: string) => t.request<void>('DELETE', p)

  return {
    assets: {
      list: (params: QueryParams = {}) => get<T.Page<T.Asset>>('/assets', params),
      tabCounts: () => get<T.AssetTabCounts>('/assets/summary'),
      get: (id: number) => get<T.AssetDetail>(`/assets/${id}`),
      create: (body: T.AssetCreate) => post<T.Asset>('/assets', body),
      update: (id: number, body: T.AssetUpdate) => patch<T.Asset>(`/assets/${id}`, body),
      remove: (id: number) => del(`/assets/${id}`),
      restore: (id: number) => post<T.Asset>(`/assets/${id}/restore`),
      assign: (id: number, body: { employee_id: number | null; effective_date?: string; location?: string | null; remark?: string }) =>
        post<T.Asset>(`/assets/${id}/assign`, body),
      retire: (id: number) => post<T.Asset>(`/assets/${id}/retire`),
      deleteAssignment: (id: number, assignmentId: number) => del(`/assets/${id}/assignments/${assignmentId}`),
      bulkAssign: (body: { items: { asset_id: number; employee_id: number | null }[]; effective_date?: string; remark?: string }) =>
        post<{ updated: number }>('/assets/bulk-assign', body),
      bulkUpdate: (body: { ids: number[]; location?: string; condition_status?: string; supplier?: string }) =>
        post<{ updated: number }>('/assets/bulk-update', body),
      bulkRetire: (ids: number[]) => post<{ updated: number }>('/assets/bulk-retire', { ids }),
      import: (items: T.AssetCreate[]) => post<{ created: number; skipped: number }>('/assets/import', { items }),
      importRepairs: (items: (T.RepairCreate & { asset_id: number })[]) => post<{ created: number }>('/assets/repairs/import', items),
      addRepair: (id: number, body: T.RepairCreate) => post<T.Repair>(`/assets/${id}/repairs`, body),
      updateRepair: (id: number, rid: number, body: Partial<T.RepairCreate>) => patch<T.Repair>(`/assets/${id}/repairs/${rid}`, body),
      deleteRepair: (id: number, rid: number) => del(`/assets/${id}/repairs/${rid}`),
      addMaintenance: (id: number, body: T.MaintenanceCreate) => post<T.Maintenance>(`/assets/${id}/maintenance`, body),
      updateMaintenance: (id: number, mid: number, body: Partial<T.MaintenanceCreate>) => patch<T.Maintenance>(`/assets/${id}/maintenance/${mid}`, body),
      deleteMaintenance: (id: number, mid: number) => del(`/assets/${id}/maintenance/${mid}`),
      repairLog: (params: QueryParams = {}) => get<T.Page<T.LogEntry<T.Repair>>>('/assets/repairs', params),
      maintenanceLog: (params: QueryParams = {}) => get<T.Page<T.LogEntry<T.Maintenance>>>('/assets/maintenance', params),
      templates: () => get<T.AssetTemplate[]>('/assets/templates'),
      saveTemplate: (type: string, attributes: string[]) => put<T.AssetTemplate>(`/assets/templates/${encodeURIComponent(type)}`, { attributes }),
      deleteTemplate: (type: string) => del(`/assets/templates/${encodeURIComponent(type)}`),
      serialSettings: () => get<T.SerialSetting[]>('/assets/serial-settings'),
      saveSerialSetting: (type: string, body: { enabled: boolean; format: string; next_number?: number }) =>
        put<T.SerialSetting>(`/assets/serial-settings/${encodeURIComponent(type)}`, body),
      generateSerial: (type: string) => post<{ serial: string }>(`/assets/serial-settings/${encodeURIComponent(type)}/generate`),
    },
    borrows: {
      list: (params: QueryParams = {}) => get<T.Page<T.Borrow>>('/borrows', params),
      create: (body: T.BorrowCreate) => post<T.Borrow>('/borrows', body),
      update: (id: number, body: Partial<T.BorrowCreate> & { returned_date?: string | null }) => patch<T.Borrow>(`/borrows/${id}`, body),
      return: (id: number, returned_date?: string) => post<T.Borrow>(`/borrows/${id}/return`, { returned_date }),
      remove: (id: number) => del(`/borrows/${id}`),
      restore: (id: number) => post<T.Borrow>(`/borrows/${id}/restore`),
    },
    documents: {
      list: (params: QueryParams = {}) => get<T.Page<T.Document>>('/documents', params),
      get: (id: number) => get<T.Document>(`/documents/${id}`),
      upload: (form: FormData) => t.request<T.Document>('POST', '/documents', { form }),
      update: (id: number, body: T.DocumentUpdate) => patch<T.Document>(`/documents/${id}`, body),
      addLink: (id: number, entity_type: string, entity_id: number) => post<T.Document>(`/documents/${id}/links`, { entity_type, entity_id }),
      removeLink: (id: number, linkId: number) => t.request<T.Document>('DELETE', `/documents/${id}/links/${linkId}`),
      remove: (id: number) => del(`/documents/${id}`),
      restore: (id: number) => post<T.Document>(`/documents/${id}/restore`),
      file: (id: number, download = false) => t.request<Blob>('GET', `/documents/${id}/file`, { params: { download }, responseType: 'blob' }),
    },
    reference: {
      all: () => get<T.ReferenceLists>('/reference'),
      add: (kind: string, name: string, meta?: Record<string, unknown>) => post<T.ReferenceItem>(`/reference/${kind}`, { name, meta }),
      update: (kind: string, id: number, name: string, meta?: Record<string, unknown>) => put<T.ReferenceItem>(`/reference/${kind}/${id}`, { name, meta }),
      remove: (kind: string, id: number) => del(`/reference/${kind}/${id}`),
    },
    employees: {
      list: (include_inactive = false) => get<T.Employee[]>('/employees', { include_inactive }),
      overview: (id: number) => get<T.EmployeeOverview>(`/employees/${id}`),
      offboard: (id: number, body: T.OffboardRequest) => post<T.OffboardResult>(`/employees/${id}/offboard`, body),
    },
    dashboard: { assets: () => get<T.AssetSummary>('/dashboard/assets') },
    reports: {
      assetCatalog: () => get<{ kind: T.AssetReportKind; title: string }[]>('/reports/assets'),
      asset: (kind: T.AssetReportKind, params: QueryParams = {}) => get<T.AssetReport>(`/reports/assets/${kind}`, params),
      assetCsv: (kind: T.AssetReportKind, params: QueryParams = {}) =>
        t.request<Blob>('GET', `/reports/assets/${kind}`, { params: { ...params, format: 'csv' }, responseType: 'blob' }),
    },
    search: { all: (q: string) => get<{ results: T.SearchHit[] }>('/search/all', { q }) },
    settings: {
      currency: () => get<T.CurrencySettings>('/settings/currency'),
      saveCurrency: (body: T.CurrencySettings) => put<T.CurrencySettings>('/settings/currency', body),
      ai: () => get<{ base_url: string; model: string; has_key: boolean; ready: boolean }>('/settings/ai'),
      saveAi: (body: { base_url: string; model: string; api_key?: string }) => put<{ ready: boolean }>('/settings/ai', body),
      alerts: () => get<{ bot_id: number | null; days: number }>('/settings/asset-alerts'),
      saveAlerts: (body: { bot_id: number | null; days: number }) => put<{ bot_id: number | null; days: number }>('/settings/asset-alerts', body),
      previewAlerts: () => post<{ message: string | null }>('/settings/asset-alerts/preview'),
    },
    account: {
      passkeys: () => get<{ id: number; name: string; created_at: string; last_used_at: string | null }[]>('/passkeys'),
      registerOptions: () => post<{ challenge_id: string; options: Record<string, unknown> }>('/passkeys/register/options'),
      registerVerify: (challenge_id: string, credential: unknown, name?: string) => post('/passkeys/register/verify', { challenge_id, credential, name }),
      deletePasskey: (id: number) => del(`/passkeys/${id}`),
      loginOptions: () => post<{ challenge_id: string; options: Record<string, unknown> }>('/auth/passkey/options'),
      loginVerify: (challenge_id: string, credential: unknown) => post<{ access_token: string; refresh_token?: string }>('/auth/passkey/verify', { challenge_id, credential }),
      requestReset: (email: string) => post<{ message: string }>('/auth/password-reset/request', { email }),
      confirmReset: (token: string, password: string) => post<{ message: string }>('/auth/password-reset/confirm', { token, password }),
      tokens: () => get<{ id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }[]>('/api-tokens'),
      createToken: (name: string) => post<{ id: number; token: string }>('/api-tokens', { name }),
      revokeToken: (id: number) => del(`/api-tokens/${id}`),
    },
  }
}

export type Api = ReturnType<typeof createApi>
