import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
  addHours,
  setHours,
  setMinutes,
} from 'date-fns'

export {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
  addHours,
  setHours,
  setMinutes,
}

// Get all days to display in a month view (includes padding days from prev/next month)
export function getMonthDays(date: Date): Date[] {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)

  return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
}

// Get all days in a week
export function getWeekDays(date: Date): Date[] {
  const weekStart = startOfWeek(date)
  const weekEnd = endOfWeek(date)

  return eachDayOfInterval({ start: weekStart, end: weekEnd })
}

// Format time for display (e.g., "9:00 AM")
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'h:mm a')
}

// Format date for display (e.g., "Jan 15")
export function formatShortDate(date: Date): string {
  return format(date, 'MMM d')
}

// Get hours array for day/week view (0-23)
export function getHoursOfDay(): number[] {
  return Array.from({ length: 24 }, (_, i) => i)
}

// Check if an event overlaps with a given day
export function eventOverlapsDay(
  eventStart: Date | string,
  eventEnd: Date | string,
  day: Date
): boolean {
  const start = typeof eventStart === 'string' ? parseISO(eventStart) : eventStart
  const end = typeof eventEnd === 'string' ? parseISO(eventEnd) : eventEnd

  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(23, 59, 59, 999)

  return start <= dayEnd && end >= dayStart
}

// Calculate event position in day/week view (top and height as percentages)
export function getEventPosition(
  eventStart: Date | string,
  eventEnd: Date | string,
  dayStart: Date
): { top: number; height: number } {
  const start = typeof eventStart === 'string' ? parseISO(eventStart) : eventStart
  const end = typeof eventEnd === 'string' ? parseISO(eventEnd) : eventEnd

  // Calculate minutes from start of day
  const dayStartTime = new Date(dayStart)
  dayStartTime.setHours(0, 0, 0, 0)

  const startMinutes = (start.getTime() - dayStartTime.getTime()) / (1000 * 60)
  const endMinutes = (end.getTime() - dayStartTime.getTime()) / (1000 * 60)

  // Convert to percentage of day (24 hours = 1440 minutes)
  const top = Math.max(0, (startMinutes / 1440) * 100)
  const height = Math.min(100 - top, ((endMinutes - startMinutes) / 1440) * 100)

  return { top, height: Math.max(height, 2) } // Min height of 2%
}
