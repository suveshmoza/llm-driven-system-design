import { format } from 'date-fns'
import { getMonthDays, isSameMonth, isToday, eventOverlapsDay } from '../../utils/dateUtils'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '../../types'

interface MonthViewProps {
  currentDate: Date
  events: CalendarEvent[]
  onDayClick: (date: Date) => void
  onEventClick: (event: CalendarEvent) => void
}

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_VISIBLE_EVENTS = 3

export function MonthView({ currentDate, events, onDayClick, onEventClick }: MonthViewProps) {
  const days = getMonthDays(currentDate)

  const getEventsForDay = (day: Date): CalendarEvent[] => {
    return events.filter((event) => eventOverlapsDay(event.start_time, event.end_time, day))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-3 text-center text-sm font-medium text-gray-500 border-r border-gray-200 last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 grid-rows-6">
        {days.map((day, index) => {
          const dayEvents = getEventsForDay(day)
          const isCurrentMonth = isSameMonth(day, currentDate)
          const isTodayDate = isToday(day)
          const hasMoreEvents = dayEvents.length > MAX_VISIBLE_EVENTS

          return (
            <div
              key={index}
              className={`
                min-h-[120px] border-r border-b border-gray-200 p-1
                ${!isCurrentMonth ? 'bg-gray-50' : 'bg-white'}
                ${index % 7 === 6 ? 'border-r-0' : ''}
                cursor-pointer hover:bg-gray-50 transition-colors
              `}
              onClick={() => onDayClick(day)}
            >
              <div className="flex items-center justify-center mb-1">
                <span
                  className={`
                    w-7 h-7 flex items-center justify-center text-sm rounded-full
                    ${isTodayDate ? 'bg-blue-600 text-white font-semibold' : ''}
                    ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                  `}
                >
                  {format(day, 'd')}
                </span>
              </div>

              <div className="space-y-1">
                {dayEvents.slice(0, MAX_VISIBLE_EVENTS).map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    compact
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick(event)
                    }}
                  />
                ))}
                {hasMoreEvents && (
                  <div className="text-xs text-gray-500 pl-1">
                    +{dayEvents.length - MAX_VISIBLE_EVENTS} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
