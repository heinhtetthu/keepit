import { useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import EmployeesPanel, { type EmployeesSection } from '../Employees'
import { useCan } from '@/components/assets/shared'
import { cn } from '@/lib/utils'

const SECTIONS: { key: EmployeesSection; label: string }[] = [
  { key: 'employees', label: 'Directory' },
  { key: 'units', label: 'Business units' },
  { key: 'departments', label: 'Departments' },
]

/** Employee directory: shared by assets, license seats and offboarding. */
export default function EmployeesPage() {
  const can = useCan()
  const [sp, setSp] = useSearchParams()
  const manage = can('employee.manage')
  const asked = sp.get('tab') as EmployeesSection | null
  const tab: EmployeesSection = manage && asked && SECTIONS.some((s) => s.key === asked) ? asked : 'employees'
  const current = SECTIONS.find((s) => s.key === tab)!
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><Users className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{tab === 'employees' ? 'Employees' : current.label}</h1>
            <p className="truncate text-sm text-gray-500">
              {tab === 'employees' ? 'Everyone who can hold assets or license seats. Open a person to see everything they hold.'
                : tab === 'units' ? 'Business units employees and records belong to.' : 'Departments employees work in. Renaming one updates every employee in it.'}
            </p>
          </div>
        </div>
        {manage && (
          <div role="tablist" className="flex rounded-lg bg-gray-100 p-1 text-sm">
            {SECTIONS.map((s) => (
              <button key={s.key} role="tab" aria-selected={tab === s.key} onClick={() => setSp(s.key === 'employees' ? {} : { tab: s.key }, { replace: true })}
                className={cn('press whitespace-nowrap rounded-md px-3 py-1.5 font-medium', tab === s.key ? 'bg-white text-gray-900 shadow-soft' : 'text-gray-500 hover:text-gray-800')}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div key={tab} className="flex min-h-0 flex-1 animate-page-in flex-col"><EmployeesPanel show={tab} /></div>
    </div>
  )
}
