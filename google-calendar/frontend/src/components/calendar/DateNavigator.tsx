import { format } from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import type { ViewType } from '../../stores/calendarStore'

interface DateNavigatorProps {
  currentDate: Date
  view: ViewType
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}

export function DateNavigator({
  currentDate,
  view,
  onPrevious,
  onNext,
  onToday,
}: DateNavigatorProps) {
  const getDateLabel = () => {
    if (view === 'month') {
      return format(currentDate, 'MMMM yyyy')
    } else if (view === 'week') {
      return format(currentDate, 'MMMM yyyy')
    } else {
      return format(currentDate, 'EEEE, MMMM d, yyyy')
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onToday}
        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        Today
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={onPrevious}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Previous"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onNext}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Next"
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      </div>

      <h2 className="text-xl font-semibold text-gray-900 min-w-[200px]">
        {getDateLabel()}
      </h2>
    </div>
  )
}
