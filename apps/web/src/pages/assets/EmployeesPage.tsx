import { useSearchParams } from 'react-router-dom'
import EmployeesPanel from '../Employees'
import { Tabs, useCan } from '@/components/assets/shared'

/** Employee directory: shared by assets, license seats and offboarding. */
export default function EmployeesPage() {
  const can = useCan()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as 'employees' | 'units') || 'employees'
  const manage = can('employee.manage')
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Employees</h1>
        <p className="mt-1 text-sm text-gray-500">Everyone who can hold assets or license seats. Open a person to see everything they hold.</p>
      </div>
      {manage && <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={[{ key: 'employees', label: 'Directory' }, { key: 'units', label: 'Business units' }]} />}
      <div key={tab} className="animate-page-in"><EmployeesPanel show={manage ? tab : 'employees'} /></div>
    </div>
  )
}
