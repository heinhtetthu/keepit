export interface PaginatedResponse<T> {
  items: T[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface RecordType {
  id: number
  name: string
  slug: string
  description: string | null
  icon: string | null
  active: boolean
  reminder_field_id: number | null
  telegram_bot_id: number | null
  track_ownership: boolean
  renew_before_days?: number | null
  fields: RecordField[]
}

export interface RecordField {
  id: number
  record_type_id: number
  name: string
  slug: string
  field_type: string
  required: boolean
  unique: boolean
  searchable: boolean
  sortable: boolean
  filterable: boolean
  show_in_list: boolean
  show_in_details: boolean
  show_in_reports: boolean
  display_order: number
  default_value: string | null
  help_text: string | null
  active: boolean
  options: FieldOption[]
}

export interface FieldOption {
  id: number
  value: string
  label: string
  display_order: number
}

export interface RecordItem {
  id: number
  record_type_id: number
  record_type_name: string
  record_type_slug: string
  name: string
  status: string
  archived: boolean
  reminder_date: string | null
  reminder_field_id: number | null
  values: { [fieldSlug: string]: any }
  created_at: string
  updated_at: string
}

export interface RecordDetailResponse {
  id: number
  record_type_id: number
  record_type_name: string
  record_type_slug: string
  name: string
  status: string
  archived: boolean
  reminder_field_id: number | null
  renew_before_days: number | null
  values: RecordValueResponse[]
  created_by: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface RecordValueResponse {
  field_id: number
  field_name: string
  field_slug: string
  field_type: string
  value: any
  display_value: string | null
}

export interface ReminderRule {
  id: number
  record_type_id: number
  name: string
  days_before: number
  active: boolean
  template: string | null
}

export interface NotificationRecipient {
  id: number
  display_name: string
  telegram_chat_id: string
  telegram_username: string | null
  telegram_bot_ids: number[]
  telegram_bot_names: string[]
  user_id: number | null
  user_name: string | null
  active: boolean
}

export interface TelegramBot {
  id: number
  name: string
  bot_token: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: number
  user_id: number | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: number | null
  entity_name: string | null
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
  details: string | null
  ip_address: string | null
  timestamp: string
}

export interface TypeBreakdown {
  record_type_id: number
  name: string
  slug: string
  count: number
}

export interface DashboardStats {
  total_records: number
  active_records: number
  expiring_soon: number
  expired: number
  expiring_by_type: TypeBreakdown[]
  expired_by_type: TypeBreakdown[]
  renewing_this_week: number
  renewing_this_month: number
  upcoming_renewals: UpcomingRenewal[]
  recently_added: RecordItem[]
  recently_modified: RecordItem[]
  notification_status?: NotificationStatus
}

export interface NotificationStatus {
  last_run_at: string | null
  active_rules: number
  active_recipients: number
  sent_24h: number
  failed_24h: number
  telegram_configured: boolean
}

export interface UpcomingRenewal {
  id: number
  name: string
  record_type: string
  reminder_date: string
  days_remaining: number
}

export interface Renewal {
  id: number
  record_id: number
  renewed_by_name: string | null
  old_date: string | null
  new_date: string
  cost: number | null
  currency: string | null
  payment_method: string | null
  payment_reference: string | null
  location: string | null
  notes: string | null
  renewed_at: string
}

export interface Employee {
  id: number
  name: string
  email: string | null
  business_units: string[]
  title: string | null
  department?: string | null
  country?: string | null
  active: boolean
  phone?: string | null
  join_date?: string | null
  resignation_date?: string | null
  gender?: string | null
  created_at: string
  updated_at: string
}

export interface RecordAssignment {
  id: number
  record_id: number
  employee_id: number | null
  employee_name: string
  business_unit: string | null
  effective_date: string
  cost: number | null
  currency: string | null
  reason: string | null
  notes: string | null
  created_by: number | null
  created_at: string
}

export interface AllocationSpan {
  assignment_id: number
  employee_name: string
  business_unit: string | null
  from: string
  to: string
  days: number
  cost: number | null
  currency: string | null
  allocated: number
}

export interface AllocationReport {
  record_type_id: number
  record_type_name: string
  start: string
  end: string
  window_days: number
  records: {
    record_id: number
    name: string
    status: string
    product: string | null
    spans: AllocationSpan[]
    allocated: number
  }[]
  business_units: { business_unit: string | null; currency: string | null; allocated: number }[]
}

export interface AppSettings {
  app_name: string
  timezone: string
  telegram_configured: boolean
  frontend_url: string | null
}

export interface SavedView {
  id: number
  name: string
  record_type_id: number | null
  filters: { [slug: string]: any } | null
  sort: { field: string; order: string } | null
  visible_columns: string[] | null
}

