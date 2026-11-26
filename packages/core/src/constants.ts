/** Domain vocabularies shared by web and mobile (from AssetWise). */
export const ASSIGNMENT_STATUSES = ['Assigned', 'Unassigned', 'Borrowed'] as const
export const CONDITION_STATUSES = ['Operational', 'In Repair', 'Written-Off'] as const
export const REPAIR_STATUSES = ['In Progress', 'Complete'] as const
export const BODY_CONDITIONS = ['Good', 'Fair', 'Needs Repair', 'Repaired', 'Not Applicable'] as const
export const TASK_STATUSES = ['Done', 'Not Done'] as const
export const OS_OPTIONS = ['Windows 10 Pro', 'Windows 11 Home', 'Windows 11 Pro', 'macOS', 'Linux', 'Other', 'Not Applicable'] as const
export const DOCUMENT_CATEGORIES = ['Invoice', 'Warranty', 'Purchase Order', 'Repair Record', 'Contract', 'Policy', 'Report', 'License', 'Other'] as const
export const VENDOR_CATEGORIES = ['Repair Shop', 'Laptop/Phone Distributor', 'Gadget Store', 'Electronics Store', 'Authorized Reseller', 'Computer Store', 'Mobile Store', 'Other'] as const
export const GENDERS = ['Male', 'Female', 'Other'] as const

export const SPEC_LABELS: Record<string, string> = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', storage: 'Storage', screenSize: 'Screen Size' }
export const DEFAULT_SPEC_KEYS = Object.keys(SPEC_LABELS)
export const specLabel = (key: string) => SPEC_LABELS[key] ?? key

const HARDWARE_PC = ['RAM', 'Ports', 'Speaker', 'Hard Drive', 'CPU', 'GPU', 'Power Supply']
const HARDWARE_LAPTOP = ['RAM', 'Keyboard', 'Charging Port', 'Ports', 'Speaker', 'Camera', 'TouchPad', 'Screen', 'Battery', 'Hard Drive', 'CPU', 'GPU']
const SOFTWARE = ['OS Updates', 'Anti-Virus Scan', 'Junk/Temp File Cleanup', 'Disk Health Check']

/** Default maintenance checklist per asset type. */
export function maintenanceChecklist(assetType: string): { hardware: string[]; software: string[] } {
  const t = assetType.toLowerCase()
  if (t === 'laptop') return { hardware: HARDWARE_LAPTOP, software: SOFTWARE }
  if (t === 'desktop' || t === 'pc') return { hardware: HARDWARE_PC, software: SOFTWARE }
  return { hardware: [], software: [] }
}

export const PERMISSIONS = {
  assetView: 'asset.view', assetCreate: 'asset.create', assetEdit: 'asset.edit', assetDelete: 'asset.delete',
  itlogView: 'itlog.view', itlogManage: 'itlog.manage',
  documentView: 'document.view', documentUpload: 'document.upload', documentEdit: 'document.edit', documentDelete: 'document.delete',
  extractionRun: 'extraction.run', referenceManage: 'reference.manage',
  employeeView: 'employee.view', employeeManage: 'employee.manage', recordView: 'record.view', recordEdit: 'record.edit',
} as const
