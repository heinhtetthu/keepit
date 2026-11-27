import { createContext, useContext, type ReactNode } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { Api } from './api'
import type { QueryParams } from './transport'
import type { HistoryEntity } from './types'

const ApiContext = createContext<Api | null>(null)

export function CoreProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside <CoreProvider>')
  return api
}

/** Query keys in one place so mutations can invalidate precisely. */
export const keys = {
  assets: (p?: QueryParams) => (p ? ['assets', p] : ['assets']) as QueryKey,
  asset: (id: number) => ['asset', id] as QueryKey,
  borrows: (p?: QueryParams) => (p ? ['borrows', p] : ['borrows']) as QueryKey,
  repairLog: (p?: QueryParams) => (p ? ['repair-log', p] : ['repair-log']) as QueryKey,
  maintenanceLog: (p?: QueryParams) => (p ? ['maintenance-log', p] : ['maintenance-log']) as QueryKey,
  documents: (p?: QueryParams) => (p ? ['documents', p] : ['documents']) as QueryKey,
  reference: ['reference'] as QueryKey,
  templates: ['asset-templates'] as QueryKey,
  serials: ['asset-serials'] as QueryKey,
  employees: (inactive = false) => ['employees', { inactive }] as QueryKey,
  employee: (id: number) => ['employee-overview', id] as QueryKey,
  assetSummary: ['asset-summary'] as QueryKey,
  currency: ['currency'] as QueryKey,
}

/** Everything an asset write can change. */
const ASSET_FAMILY = ['assets', 'asset', 'borrows', 'repair-log', 'maintenance-log', 'employee-overview', 'employees', 'asset-summary', 'documents']

export function useInvalidateAssets() {
  const qc = useQueryClient()
  return () => Promise.all(ASSET_FAMILY.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

export function useAssets(params: QueryParams) {
  const api = useApi()
  return useQuery({ queryKey: keys.assets(params), queryFn: () => api.assets.list(params), placeholderData: keepPreviousData })
}

/** Counts for the asset list's preset tabs. */
export function useAssetTabCounts() {
  const api = useApi()
  return useQuery({ queryKey: ['assets', 'tab-counts'], queryFn: () => api.assets.tabCounts(), refetchInterval: 60_000 })
}

export function useAsset(id: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.asset(id), queryFn: () => api.assets.get(id), enabled: id > 0 })
}

export function useBorrows(params: QueryParams) {
  const api = useApi()
  return useQuery({ queryKey: keys.borrows(params), queryFn: () => api.borrows.list(params), placeholderData: keepPreviousData })
}

export function useRepairLog(params: QueryParams) {
  const api = useApi()
  return useQuery({ queryKey: keys.repairLog(params), queryFn: () => api.assets.repairLog(params), placeholderData: keepPreviousData })
}

export function useMaintenanceLog(params: QueryParams) {
  const api = useApi()
  return useQuery({ queryKey: keys.maintenanceLog(params), queryFn: () => api.assets.maintenanceLog(params), placeholderData: keepPreviousData })
}

export function useDocuments(params: QueryParams, enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: keys.documents(params), queryFn: () => api.documents.list(params), placeholderData: keepPreviousData, enabled })
}

/** Lookup lists change rarely: cache them for the session. */
export function useReference() {
  const api = useApi()
  return useQuery({ queryKey: keys.reference, queryFn: api.reference.all, staleTime: 5 * 60_000 })
}

export function useTemplates() {
  const api = useApi()
  return useQuery({ queryKey: keys.templates, queryFn: api.assets.templates, staleTime: 5 * 60_000 })
}

export function useSerialSettings() {
  const api = useApi()
  return useQuery({ queryKey: keys.serials, queryFn: api.assets.serialSettings, staleTime: 60_000 })
}

export function useEmployees(includeInactive = false) {
  const api = useApi()
  return useQuery({ queryKey: keys.employees(includeInactive), queryFn: () => api.employees.list(includeInactive), staleTime: 10_000 })
}

export function useEmployeeOverview(id: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.employee(id), queryFn: () => api.employees.overview(id), enabled: id > 0 })
}

export function useAssetSummary(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: keys.assetSummary, queryFn: api.dashboard.assets, enabled, staleTime: 30_000 })
}

export function useCurrency() {
  const api = useApi()
  return useQuery({ queryKey: keys.currency, queryFn: api.settings.currency, staleTime: 10 * 60_000 })
}

/** Mutation that refreshes every asset-related view on success. */
export function useAssetMutation<V, R>(fn: (api: Api, vars: V) => Promise<R>) {
  const api = useApi()
  const invalidate = useInvalidateAssets()
  return useMutation({ mutationFn: (vars: V) => fn(api, vars), onSuccess: () => { void invalidate() } })
}

/** Activity history of one asset, record or employee; pages are appended for "load more". */
export function useEntityHistory(entity: HistoryEntity, id: number, kind?: string, pageSize = 20) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: ['entity-history', entity, id, kind ?? ''],
    queryFn: ({ pageParam }) => api.history.list(entity, id, { page: pageParam, page_size: pageSize, kind: kind || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    enabled: id > 0,
  })
}
