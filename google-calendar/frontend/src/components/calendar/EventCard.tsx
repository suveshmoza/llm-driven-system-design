import { formatTime } from '../../utils/dateUtils'
import type { CalendarEvent } from '../../types'

interface EventCardProps {
  event: CalendarEvent
  onClick?: (e: React.MouseEvent) => void
  showTime?: boolean
  compact?: boolean
}

export function EventCard({ event, onClick, showTime = true, compact = false }: EventCardProps) {
  const backgroundColor = event.color || '#3B82F6'

  if (compact) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left text-xs px-1.5 py-0.5 rounded truncate transition-opacity hover:opacity-80"
        style={{ backgroundColor, color: 'white' }}
        title={event.title}
      >
        {event.title}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1 rounded text-sm transition-opacity hover:opacity-80"
      style={{ backgroundColor, color: 'white' }}
    >
      <div className="font-medium truncate">{event.title}</div>
      {showTime && !event.all_day && (
        <div className="text-xs opacity-90">
          {formatTime(event.start_time)} - {formatTime(event.end_time)}
        </div>
      )}
    </button>
  )
}
