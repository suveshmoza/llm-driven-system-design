import { MiniCalendar } from './MiniCalendar'
import { useCalendarStore } from '../../stores/calendarStore'
import { PlusIcon, CheckIcon } from '../icons'

interface CalendarSidebarProps {
  onCreateEvent: () => void
}

export function CalendarSidebar({ onCreateEvent }: CalendarSidebarProps) {
  const {
    currentDate,
    setCurrentDate,
    calendars,
    visibleCalendarIds,
    toggleCalendarVisibility,
  } = useCalendarStore()

  return (
    <div className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-6">
      <button
        onClick={onCreateEvent}
        className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-full shadow-md hover:shadow-lg transition-shadow text-gray-700 font-medium"
      >
        <PlusIcon className="w-6 h-6 text-blue-600" />
        Create
      </button>

      <MiniCalendar selectedDate={currentDate} onDateSelect={setCurrentDate} />

      <div>
        <h3 className="text-sm font-medium text-gray-500 mb-3">My calendars</h3>
        <ul className="space-y-2">
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                    ${visibleCalendarIds.has(calendar.id) ? '' : 'bg-white'}
                  `}
                  style={{
                    borderColor: calendar.color,
                    backgroundColor: visibleCalendarIds.has(calendar.id)
                      ? calendar.color
                      : 'transparent',
                  }}
                >
                  {visibleCalendarIds.has(calendar.id) && (
                    <CheckIcon className="w-3 h-3 text-white" />
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={visibleCalendarIds.has(calendar.id)}
                  onChange={() => toggleCalendarVisibility(calendar.id)}
                  className="sr-only"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">
                  {calendar.name}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
