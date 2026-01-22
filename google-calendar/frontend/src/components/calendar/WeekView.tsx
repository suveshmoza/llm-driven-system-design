import { format } from 'date-fns'
import { getWeekDays, getHoursOfDay, eventOverlapsDay, getEventPosition, isToday, parseISO } from '../../utils/dateUtils'
import type { CalendarEvent } from '../../types'

interface WeekViewProps {
  currentDate: Date
  events: CalendarEvent[]
  onTimeSlotClick: (date: Date, hour: number) => void
  onEventClick: (event: CalendarEvent) => void
}

export function WeekView({ currentDate, events, onTimeSlotClick, onEventClick }: WeekViewProps) {
  const days = getWeekDays(currentDate)
  const hours = getHoursOfDay()

  const getEventsForDay = (day: Date): CalendarEvent[] => {
    return events.filter((event) => eventOverlapsDay(event.start_time, event.end_time, day))
  }

  const formatHour = (hour: number): string => {
    if (hour === 0) return '12 AM'
    if (hour === 12) return '12 PM'
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with day names */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <div className="w-16 flex-shrink-0" />
        {days.map((day) => {
          const isTodayDate = isToday(day)
          return (
            <div
              key={day.toISOString()}
              className="flex-1 text-center py-3 border-l border-gray-200"
            >
              <div className="text-sm text-gray-500">{format(day, 'EEE')}</div>
              <div
                className={`
                  w-10 h-10 mx-auto flex items-center justify-center text-lg font-medium rounded-full
                  ${isTodayDate ? 'bg-blue-600 text-white' : 'text-gray-900'}
                `}
              >
                {format(day, 'd')}
              </div>
            </div>
          )
        })}
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

          {/* Day columns */}
          {days.map((day) => {
            const dayEvents = getEventsForDay(day).filter((e) => !e.all_day)
            return (
              <div key={day.toISOString()} className="flex-1 border-l border-gray-200 relative">
                {/* Hour slots */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="h-[60px] border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => onTimeSlotClick(day, hour)}
                  />
                ))}

                {/* Events */}
                {dayEvents.map((event) => {
                  const { top, height } = getEventPosition(event.start_time, event.end_time, day)
                  return (
                    <button
                      key={event.id}
                      className="absolute left-1 right-1 rounded px-2 py-1 text-xs text-white overflow-hidden hover:opacity-90 transition-opacity"
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        minHeight: '20px',
                        backgroundColor: event.color || '#3B82F6',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick(event)
                      }}
                    >
                      <div className="font-medium truncate">{event.title}</div>
                      <div className="opacity-90 truncate">
                        {format(parseISO(event.start_time), 'h:mm a')}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
