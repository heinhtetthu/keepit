import { useNavigate } from 'react-router-dom'
import { Clock3, Trash2, FileText, LayoutGrid } from 'lucide-react'
import Popover from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import TypeIcon from '@/components/TypeIcon'
import { useRecent, removeRecent, clearRecent, timeAgo } from '@/store/recent'
import { cn } from '@/lib/utils'

export default function RecentDropdown() {
  const navigate = useNavigate()
  const recent = useRecent()

  return (
    <Popover
      align="right"
      panelClassName="w-[calc(100vw-2rem)] max-w-sm max-h-[min(28rem,calc(100vh-7rem))] overflow-y-auto p-1.5"
      trigger={
        <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-500" title="Recently viewed" aria-label="Recently viewed">
          <Clock3 className="h-[18px] w-[18px]" />
        </Button>
      }
    >
      {recent.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-gray-400 leading-relaxed">
          Nothing visited yet.<br />Records and pages you open appear here for one-click access.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Recently viewed</p>
            <button
              className="text-[11px] text-gray-400 hover:text-red-600 inline-flex items-center gap-1 px-1"
              onClick={() => clearRecent()}
              title="Clear the list"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="space-y-0.5">
            {recent.map((item) => (
              <div
                key={item.url}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-gray-50 transition-colors',
                )}
              >
                <button
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  onClick={() => navigate(item.url)}
                  title={item.label}
                >
                  <span className="h-8 w-8 rounded-md bg-gray-100 border flex items-center justify-center shrink-0 relative">
                    {item.kind === 'record' || item.icon
                      ? <TypeIcon icon={item.icon} className="h-4 w-4 text-gray-600" />
                      : <LayoutGrid className="h-4 w-4 text-gray-400" />}
                    <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white border p-0.5 text-gray-400">
                      {item.kind === 'record'
                        ? <FileText className="h-2 w-2" />
                        : <LayoutGrid className="h-2 w-2" />}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800 truncate">{item.label}</span>
                    <span className="block text-[11px] text-gray-400 truncate">
                      {item.sublabel ? `${item.sublabel} · ` : ''}{timeAgo(item.at)}
                    </span>
                  </span>
                </button>
                <button
                  className="p-1.5 rounded text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600 hover:bg-red-50 shrink-0"
                  title="Remove from recent"
                  aria-label={`Remove ${item.label} from recently viewed`}
                  onClick={() => removeRecent(item.url)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Popover>
  )
}
