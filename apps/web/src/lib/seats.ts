import type { RecordField, RecordType } from '../types'

/* Field lookups for "seat" style record types (licenses and the like).
   Mirrors the backend conventions in services/assignment.py and record.py:
   a dedicated field type wins, otherwise a known field name is used. */

const norm = (s: string) => s.trim().toLowerCase()

function byName(rt: RecordType | undefined, names: string[]): RecordField | undefined {
  const wanted = new Set(names.flatMap((n) => [norm(n), norm(n).replace(/ /g, '_')]))
  return rt?.fields?.find((f) => f.active && f.field_type !== 'secret' && (wanted.has(norm(f.name)) || wanted.has(f.slug)))
}

function byType(rt: RecordType | undefined, type: string, names: string[]): RecordField | undefined {
  return rt?.fields?.find((f) => f.active && f.field_type === type) ?? byName(rt, names)
}

export interface SeatFields {
  assignee?: RecordField
  email?: RecordField
  businessUnit?: RecordField
  product?: RecordField
  cost?: RecordField
  currency?: RecordField
  autoRenew?: RecordField
  expiry?: RecordField
}

export function seatFields(rt: RecordType | undefined): SeatFields {
  return {
    assignee: byType(rt, 'employee', ['Assigned To', 'Assignee', 'Holder', 'User']),
    email: rt?.track_ownership ? rt.fields?.find((f) => f.active && f.field_type === 'email') : undefined,
    businessUnit: byType(rt, 'business_unit', ['Business Unit', 'BU']),
    product: byName(rt, ['Product Name', 'Product', 'License Plan', 'Plan']),
    cost: byName(rt, ['Cost', 'Seat Cost', 'Seat Cost (Monthly)']),
    currency: byName(rt, ['Currency']),
    autoRenew: byName(rt, ['Auto Renewal', 'Auto-renewal', 'Auto Renewal?', 'Auto Renew', 'Auto-renew']),
    expiry: rt?.fields?.find((f) => f.id === rt.reminder_field_id && f.active),
  }
}

export const todayLocal = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD

export function initials(name: string | null | undefined): string {
  const parts = (name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || fallback
}
