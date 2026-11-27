import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react'
import TruncatedText from '@/components/ui/truncated-text'
import { TableCard, TableScrollArea, TablePager } from '@/components/table_shell'
import { cn } from '@/lib/utils'

export interface Column<T> {
  id: string
  label: string
  /** Sort key sent to the API (or used in the browser). Leave out for unsortable columns. */
  sort?: string
  render: (row: T) => ReactNode
  /** Always shown and not in the column picker (e.g. the name column). */
  locked?: boolean
  align?: 'left' | 'right'
  /** Extra classes for this column's cells. */
  className?: string
  /** Keep the cell on one line (default true). */
  nowrap?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  rowKey: (row: T) => string | number
  columns: Column<T>[]
  /** Visible column ids. Locked columns always show. Leave out to show all. */
  visible?: string[]
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (key: string) => void
  loading?: boolean
  /** Data is refreshing in the background: dim the rows. */
  fetching?: boolean
  error?: string | null
  empty?: ReactNode
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined | false
  /** Row checkboxes. */
  selected?: (string | number)[]
  onSelectedChange?: (ids: (string | number)[]) => void
  /** Cell at the end of each row (a RowMenu, buttons…). */
  actions?: (row: T) => ReactNode
  /** Footer pager. Leave out for short lists. */
  pager?: { page: number; pages: number; total: number; pageSize: number; onPage: (n: number) => void; onPageSize: (n: number) => void; noun?: string }
  /** Bar above the rows inside the card (rarely needed). */
  header?: ReactNode
  className?: string
  /** Max height for embedded tables (detail pages). Full pages fill the space they have. */
  maxHeight?: string
  dense?: boolean
}

/**
 * The one table used across Keepit. The card is only as tall as its rows, so
 * the footer sits right under the last row; on long lists the rows scroll
 * under a sticky header while the footer stays put.
 */
export default function DataTable<T>({
  rows, rowKey, columns, visible, sort, order, onSort, loading, fetching, error, empty, onRowClick, rowClassName,
  selected, onSelectedChange, actions, pager, header, className, maxHeight, dense,
}: DataTableProps<T>) {
  const cols = columns.filter((c) => c.locked || !visible || visible.includes(c.id))
  const selectable = !!onSelectedChange
  const ids = rows.map(rowKey)
  const sel = selected ?? []
  const all = ids.length > 0 && ids.every((id) => sel.includes(id))
  const some = ids.some((id) => sel.includes(id))
  const toggle = (id: string | number) => onSelectedChange?.(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
  const pad = dense ? 'py-2' : 'py-2.5'
  const span = cols.length + (selectable ? 1 : 0) + (actions ? 1 : 0)

  return (
    <TableCard className={cn('shrink', className)} header={header} footer={pager && (
      <TablePager shown={rows.length} total={pager.total} noun={pager.noun} page={pager.page} pages={pager.pages} onPage={pager.onPage} pageSize={pager.pageSize} onPageSize={pager.onPageSize} />
    )}>
      <TableScrollArea className={cn('min-h-0', maxHeight)}>
        <table className={cn('w-full text-sm transition-opacity', fetching && 'opacity-70')}>
          <thead className="sticky top-0 z-20 bg-gray-50/95 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 backdrop-blur">
            <tr className="border-b">
              {selectable && (
                <th className="w-10 py-2.5 pl-4 pr-1">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer align-middle accent-primary" checked={all} aria-label="Select all on this page"
                    ref={(el) => { if (el) el.indeterminate = some && !all }} onChange={() => onSelectedChange?.(all ? sel.filter((x) => !ids.includes(x)) : [...new Set([...sel, ...ids])])} />
                </th>
              )}
              {cols.map((c) => <HeaderCell key={c.id} col={c} sort={sort} order={order} onSort={onSort} />)}
              {actions && <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? [0, 1, 2, 3, 4].map((i) => (
              <tr key={i}><td colSpan={span} className="px-4 py-2.5"><div className="h-6 animate-pulse rounded bg-gray-100" /></td></tr>
            )) : error ? (
              <tr><td colSpan={span} className="px-4 py-8 text-center text-sm text-red-600">{error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={span}>{empty ?? <EmptyRows />}</td></tr>
            ) : rows.map((row) => {
              const id = rowKey(row)
              const isSel = sel.includes(id)
              return (
                <tr key={id} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('group transition-colors hover:bg-gray-50', onRowClick && 'cursor-pointer', isSel && 'bg-primary/5 hover:bg-primary/10', rowClassName?.(row))}>
                  {selectable && (
                    <td className={cn(pad, 'pl-4 pr-1')} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={isSel} onChange={() => toggle(id)} aria-label="Select row" />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.id} className={cn('px-3 text-gray-700', pad, c.nowrap !== false && 'whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.render(row)}</td>
                  ))}
                  {actions && <td className={cn('px-2 text-right', pad)} onClick={(e) => e.stopPropagation()}>{actions(row)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScrollArea>
    </TableCard>
  )
}

function HeaderCell<T>({ col, sort, order, onSort }: { col: Column<T>; sort?: string; order?: 'asc' | 'desc'; onSort?: (k: string) => void }) {
  const active = !!col.sort && sort === col.sort
  return (
    <th className={cn('px-1.5 py-1.5', col.align === 'right' && 'text-right')} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}>
      {!col.sort || !onSort ? <span className="block whitespace-nowrap px-1.5 py-1">{col.label}</span> : (
        <button onClick={() => onSort(col.sort!)} className={cn('group/sort inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded px-1.5 py-1 uppercase tracking-wider hover:bg-gray-200/60 hover:text-gray-900', active && 'text-gray-900')}>
          {col.label}
          {active ? (order === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />) : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 group-hover/sort:opacity-60" />}
        </button>
      )}
    </th>
  )
}

export function EmptyRows({ title = 'Nothing to show', hint = 'Try another tab or clear the filters.', icon }: { title?: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="text-gray-300">{icon ?? <Inbox className="h-9 w-9" />}</span>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  )
}

/** Primary cell: bold title with a muted second line. */
export function TitleCell({ title, sub, className }: { title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 max-w-[20rem]', className)}>
      {typeof title === 'string' ? <TruncatedText text={title} className="font-medium text-gray-900" /> : <div className="truncate font-medium text-gray-900">{title}</div>}
      {sub && (typeof sub === 'string' ? <TruncatedText text={sub} className="text-xs text-gray-500" /> : <div className="truncate text-xs text-gray-500">{sub}</div>)}
    </div>
  )
}
