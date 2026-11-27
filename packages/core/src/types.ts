import type { Schemas } from '@workspace/api-client'

export type Asset = Schemas['AssetResponse']
export type AssetDetail = Schemas['AssetDetailResponse']
export type AssetTabCounts = Schemas['AssetTabCounts']
export type AssetCreate = Schemas['AssetCreate']
export type AssetUpdate = Schemas['AssetUpdate']
export type Repair = Schemas['RepairResponse']
export type RepairCreate = Schemas['RepairCreate']
export type Maintenance = Schemas['MaintenanceResponse']
export type MaintenanceCreate = Schemas['MaintenanceCreate']
export type Borrow = Schemas['BorrowResponse']
export type BorrowCreate = Schemas['BorrowCreate']
export type Assignment = Schemas['AssetAssignmentResponse']
export type SerialSetting = Schemas['SerialSettingResponse']
export type Document = Schemas['DocumentResponse']
export type DocumentUpdate = Schemas['DocumentUpdate']
export type Employee = Schemas['EmployeeResponse']
export type OffboardRequest = Schemas['OffboardRequest']

export interface Page<T> { items: T[]; page: number; page_size: number; total: number; total_pages: number }
export type LogEntry<T> = T & { asset_name: string; asset_type?: string | null; serial_number?: string | null }

export interface ReferenceItem { id: number; kind: string; name: string; sort_order: number; meta: Record<string, unknown> }
export type ReferenceLists = Record<'brand' | 'asset_type' | 'location' | 'region' | 'vendor', ReferenceItem[]>
export interface AssetTemplate { asset_type: string; attributes: string[] }

export interface Seat { record_id: number; name: string; record_type_id: number; record_type_name: string; record_type_slug: string; product: string | null; since: string | null }
export interface EmployeeOverview {
  employee: Employee
  assets: Asset[]
  asset_history: (Assignment & { asset_name: string })[]
  borrows: Borrow[]
  seats: Seat[]
  documents: Document[]
}
export interface OffboardResult { assets_returned: number; borrows_closed: number; seats_released: number; deactivated: boolean }

export interface AssetSummary {
  total: number
  by_assignment_status: Record<string, number>
  by_condition: Record<string, number>
  by_type: { name: string; count: number }[]
  by_business_unit: { name: string; count: number }[]
  by_age: Record<string, number>
  warranty_expiring_60d: number
  open_borrows: number
  overdue_borrows: number
  repair_costs_12m: { month: string; cost: number; count: number }[]
  documents_expiring_60d: number
}

export interface SearchHit { kind: 'type' | 'record' | 'asset' | 'employee' | 'document'; title: string; subtitle?: string; url: string; id?: number; icon?: string | null }

export interface CurrencySettings { default_currency: string; rates: Record<string, number>; rates_updated_at?: Record<string, string> }

export type AssetReportKind = 'inventory' | 'repairs' | 'maintenance' | 'borrows' | 'warranties' | 'holders'
export interface AssetReport {
  kind: AssetReportKind
  title: string
  columns: { key: string; label: string; type?: 'text' | 'choice' | 'date' | 'money' | 'number' }[]
  rows: Record<string, string | number | null>[]
  summary: { label: string; value: string | number }[]
  truncated: boolean
  window?: { from: string; to: string }
}

export type HistoryEntity = 'asset' | 'record' | 'employee'
export interface HistoryChange { field: string; label: string; before: unknown; after: unknown }
export interface HistoryEntry {
  id: string
  audit_id: number | null
  kind: string
  action: string
  summary: string
  actor_id: number | null
  actor_name: string | null
  timestamp: string
  changes: HistoryChange[]
  details: string | null
  restorable: boolean
  /** true when the sentence is about the entity itself (e.g. "holds Dell XPS"), not about the actor. */
  subject: boolean
  link: { type: string; id: number; slug?: string | null } | null
}
export interface HistoryPage extends Page<HistoryEntry> { kinds: { key: string; label: string; count: number }[]; can_restore: boolean }
export interface HistoryRestorePreview { audit_id: number; changes: HistoryChange[]; restored_entry_id?: number | null }
