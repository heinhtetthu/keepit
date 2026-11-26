/**
 * MCP server (stdio) for AI clients such as Claude Desktop.
 *
 * Unlike the old AssetWise server it never touches the database: every tool
 * calls the public REST API with a personal API token, so permissions, audit
 * logging and validation are exactly the same as in the web app.
 *
 *   API_URL=https://app.example.com/api/v1  API_TOKEN=rnw_...  node dist/index.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createApi, createFetchTransport, errorMessage, todayISO } from '@workspace/core'

const API_URL = (process.env.API_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '')
const API_TOKEN = process.env.API_TOKEN || ''
if (!API_TOKEN.startsWith('rnw_')) {
  console.error('[mcp] API_TOKEN is missing. Create one in Settings > Account > API tokens.')
  process.exit(1)
}

const transport = createFetchTransport(API_URL, { getAccess: () => API_TOKEN, setAccess: () => undefined, getRefresh: () => null, setRefresh: () => undefined })
const api = createApi(transport)
const MAX_TEXT = 200_000

const ok = (data: unknown): CallToolResult => {
  let text = JSON.stringify(data, null, 2) ?? 'Done'
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n…truncated (${text.length} chars). Narrow the query.`
  return { content: [{ type: 'text', text }] }
}
const fail = (e: unknown): CallToolResult => ({ content: [{ type: 'text', text: errorMessage(e) }], isError: true })

type Shape = Record<string, z.ZodTypeAny>
const server = new McpServer({ name: 'keepit', version: '1.0.0' })

function tool<S extends Shape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, readOnly = true) {
  // The SDK's generic signature is heavy for TS; the runtime contract is simple.
  ;(server.registerTool as unknown as (n: string, c: object, h: (a: never) => Promise<CallToolResult>) => void)(
    name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } },
    async (args: never) => { try { return ok(await run(args)) } catch (e) { return fail(e) } },
  )
}

const page = { page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(200).optional() }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

// ------------------------------------------------------------------ reads
tool('search', 'Search records (renewals), assets, employees and documents by text.', { q: z.string().min(1) }, ({ q }) => api.search.all(q))
tool('list_assets', 'List assets with optional filters.', {
  q: z.string().optional(), asset_type: z.string().optional(), assignment_status: z.enum(['Assigned', 'Unassigned', 'Borrowed']).optional(),
  condition_status: z.enum(['Operational', 'In Repair', 'Written-Off']).optional(), employee_id: z.number().int().optional(),
  warranty_before: date.optional(), ...page,
}, (a) => api.assets.list(a))
tool('get_asset', 'Asset with assignment, repair, maintenance and borrow history.', { asset_id: z.number().int() }, ({ asset_id }) => api.assets.get(asset_id))
tool('list_employees', 'Employee directory.', { include_inactive: z.boolean().optional() }, ({ include_inactive }) => api.employees.list(!!include_inactive))
tool('get_employee', 'Employee 360: held assets, history, borrows, license seats, documents.', { employee_id: z.number().int() }, ({ employee_id }) => api.employees.overview(employee_id))
tool('list_borrows', 'Borrow log.', { status: z.enum(['open', 'overdue', 'returned']).optional(), q: z.string().optional(), ...page }, (a) => api.borrows.list(a))
tool('list_repairs', 'Repair log across all assets.', { q: z.string().optional(), ...page }, (a) => api.assets.repairLog(a))
tool('list_maintenance', 'Maintenance log across all assets.', { q: z.string().optional(), ...page }, (a) => api.assets.maintenanceLog(a))
tool('asset_summary', 'Counts by status/type/business unit/age, overdue borrows, expiring warranties and repair spend.', {}, () => api.dashboard.assets())
tool('list_documents', 'Documents, optionally for one entity.', {
  q: z.string().optional(), category: z.string().optional(), entity_type: z.enum(['asset', 'employee', 'record', 'borrow']).optional(),
  entity_id: z.number().int().optional(), expiring_before: date.optional(), ...page,
}, (a) => api.documents.list(a))
tool('get_reference_data', 'Lookup lists: asset types, brands, locations, regions, vendors.', {}, () => api.reference.all())

// ------------------------------------------------------------------ writes
tool('create_asset', 'Create an asset (optionally assigned).', {
  asset_type: z.string(), brand: z.string().optional(), model: z.string().optional(), serial_number: z.string().optional(),
  location: z.string().optional(), purchase_date: date.optional(), warranty_end_date: date.optional(), supplier: z.string().optional(),
  specs: z.record(z.string(), z.string()).optional(), employee_id: z.number().int().optional(),
}, (a) => api.assets.create({ ...a, specs: a.specs ?? {} }), false)
tool('update_asset', 'Update asset fields.', {
  asset_id: z.number().int(), brand: z.string().optional(), model: z.string().optional(), serial_number: z.string().optional(),
  location: z.string().optional(), warranty_end_date: date.optional(), supplier: z.string().optional(), notes: z.string().optional(),
}, ({ asset_id, ...rest }) => api.assets.update(asset_id, rest), false)
tool('assign_asset', 'Assign an asset to an employee, or unassign with employee_id null.', {
  asset_id: z.number().int(), employee_id: z.number().int().nullable(), effective_date: date.optional(), remark: z.string().optional(),
}, ({ asset_id, ...rest }) => api.assets.assign(asset_id, rest), false)
tool('retire_asset', 'Write off an asset (unassigns it).', { asset_id: z.number().int() }, ({ asset_id }) => api.assets.retire(asset_id), false)
tool('log_repair', 'Log a repair on an asset.', {
  asset_id: z.number().int(), repair_date: date, issue: z.string(), status: z.enum(['In Progress', 'Complete']).default('Complete'),
  cost: z.number().optional(), vendor: z.string().optional(), notes: z.string().optional(),
}, ({ asset_id, cost, ...rest }) => api.assets.addRepair(asset_id, { ...rest, cost: cost === undefined ? null : String(cost) }), false)
tool('log_maintenance', 'Log a maintenance check.', {
  asset_id: z.number().int(), maintenance_date: date, body_condition: z.enum(['Good', 'Fair', 'Needs Repair', 'Repaired', 'Not Applicable']).default('Good'),
  operating_system: z.string().optional(), notes: z.string().optional(),
}, ({ asset_id, ...rest }) => api.assets.addMaintenance(asset_id, rest), false)
tool('lend_item', 'Record a borrow (asset or untracked item).', {
  asset_id: z.number().int().optional(), item_name: z.string().optional(), employee_id: z.number().int().optional(),
  borrower_name: z.string().optional(), borrowed_date: date.optional(), expected_return_date: date.optional(), notes: z.string().optional(),
}, (a) => api.borrows.create({ ...a, borrowed_date: a.borrowed_date ?? todayISO() }), false)
tool('return_borrow', 'Mark a borrow returned.', { borrow_id: z.number().int(), returned_date: date.optional() },
  ({ borrow_id, returned_date }) => api.borrows.return(borrow_id, returned_date), false)
tool('offboard_employee', 'Offboard: return assets, close borrows, release license seats, deactivate.', {
  employee_id: z.number().int(), effective_date: date, return_assets: z.boolean().default(true), close_borrows: z.boolean().default(true),
  release_seats: z.boolean().default(true), deactivate: z.boolean().default(true),
}, ({ employee_id, ...rest }) => api.employees.offboard(employee_id, { reason: 'Resignation', ...rest }), false)

async function main() {
  await server.connect(new StdioServerTransport())
  console.error(`[mcp] ready → ${API_URL}`)  // stdout is the JSON-RPC channel
}
main().catch((e) => { console.error('[mcp] fatal:', e); process.exit(1) })
