import { format } from 'date-fns'
import { getHoursOfDay, eventOverlapsDay, getEventPosition, parseISO } from '../../utils/dateUtils'
import type { CalendarEvent } from '../../types'

interface DayViewProps {
  currentDate: Date
  events: CalendarEvent[]
  onTimeSlotClick: (date: Date, hour: number) => void
  onEventClick: (event: CalendarEvent) => void
}

export function DayView({ currentDate, events, onTimeSlotClick, onEventClick }: DayViewProps) {
  const hours = getHoursOfDay()
  const dayEvents = events
    .filter((event) => eventOverlapsDay(event.start_time, event.end_time, currentDate))
    .filter((e) => !e.all_day)

  const formatHour = (hour: number): string => {
    if (hour === 0) return '12 AM'
    if (hour === 12) return '12 PM'
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <div className="w-16 flex-shrink-0" />
        <div className="flex-1 text-center py-4 border-l border-gray-200">
          <div className="text-sm text-gray-500">{format(currentDate, 'EEEE')}</div>
          <div className="text-3xl font-light text-gray-900">{format(currentDate, 'd')}</div>
        </div>
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-[1440px]">
          {/* Time labels */}
          <div className="w-16 flex-shrink-0">
            {hours.map((hour) => (
              <div
                key={hour}
                className="h-[60px] text-right pr-2 text-xs text-gray-500 -mt-2 first:mt-0"
              >
                {hour > 0 && formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div className="flex-1 border-l border-gray-200 relative">
            {/* Hour slots */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="h-[60px] border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                onClick={() => onTimeSlotClick(currentDate, hour)}
              />
            ))}

            {/* Events */}
            {dayEvents.map((event) => {
              const { top, height } = getEventPosition(
                event.start_time,
                event.end_time,
                currentDate
              )
              return (
                <button
                  key={event.id}
                  className="absolute left-1 right-1 rounded px-3 py-2 text-white overflow-hidden hover:opacity-90 transition-opacity text-left"
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    minHeight: '30px',
                    backgroundColor: event.color || '#3B82F6',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventClick(event)
                  }}
                >
                  <div className="font-medium">{event.title}</div>
                  <div className="text-sm opacity-90">
                    {format(parseISO(event.start_time), 'h:mm a')} -{' '}
                    {format(parseISO(event.end_time), 'h:mm a')}
                  </div>
                  {event.location && (
                    <div className="text-sm opacity-75 mt-1">{event.location}</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
