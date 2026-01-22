import { format, isSameDay } from 'date-fns'
import { getMonthDays, isSameMonth, isToday } from '../../utils/dateUtils'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import { useState } from 'react'
import { addMonths, subMonths } from 'date-fns'

interface MiniCalendarProps {
  selectedDate: Date
  onDateSelect: (date: Date) => void
}

const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function MiniCalendar({ selectedDate, onDateSelect }: MiniCalendarProps) {
  const [displayMonth, setDisplayMonth] = useState(selectedDate)
  const days = getMonthDays(displayMonth)

  return (
    <div className="bg-white rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setDisplayMonth(subMonths(displayMonth, 1))}
          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-sm font-medium text-gray-900">
          {format(displayMonth, 'MMMM yyyy')}
        </span>
        <button
          onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}
          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ChevronRightIcon className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day, i) => (
          <div key={i} className="text-center text-xs font-medium text-gray-500 py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const isCurrentMonth = isSameMonth(day, displayMonth)
          const isSelected = isSameDay(day, selectedDate)
          const isTodayDate = isToday(day)

          return (
            <button
              key={i}
              onClick={() => onDateSelect(day)}
              className={`
                w-7 h-7 text-xs rounded-full flex items-center justify-center transition-colors
                ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                ${isSelected ? 'bg-blue-600 text-white' : ''}
                ${isTodayDate && !isSelected ? 'bg-blue-100 text-blue-600' : ''}
                ${!isSelected && isCurrentMonth ? 'hover:bg-gray-100' : ''}
              `}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
