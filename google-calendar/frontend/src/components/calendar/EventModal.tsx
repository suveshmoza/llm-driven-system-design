import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { XMarkIcon, TrashIcon, ExclamationTriangleIcon } from '../icons'
import { useCalendarStore } from '../../stores/calendarStore'
import { createEvent, updateEvent, deleteEvent } from '../../services/api'
import type { CalendarEvent, ConflictingEvent } from '../../types'

interface EventModalProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  event?: CalendarEvent | null
  defaultDate?: Date | null
  onClose: () => void
  onEventCreated: (event: CalendarEvent) => void
  onEventUpdated: (event: CalendarEvent) => void
  onEventDeleted: (id: number) => void
}

const COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#6B7280', // gray
]

export function EventModal({
  isOpen,
  mode,
  event,
  defaultDate,
  onClose,
  onEventCreated,
  onEventUpdated,
  onEventDeleted,
}: EventModalProps) {
  const { calendars } = useCalendarStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [calendarId, setCalendarId] = useState<number | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState<ConflictingEvent[]>([])

  useEffect(() => {
    if (mode === 'edit' && event) {
      setTitle(event.title)
      setDescription(event.description || '')
      setLocation(event.location || '')
      const start = new Date(event.start_time)
      const end = new Date(event.end_time)
      setStartDate(format(start, 'yyyy-MM-dd'))
      setStartTime(format(start, 'HH:mm'))
      setEndDate(format(end, 'yyyy-MM-dd'))
      setEndTime(format(end, 'HH:mm'))
      setAllDay(event.all_day)
      setCalendarId(event.calendar_id)
      setColor(event.color || COLORS[0])
    } else if (mode === 'create') {
      const date = defaultDate || new Date()
      setTitle('')
      setDescription('')
      setLocation('')
      setStartDate(format(date, 'yyyy-MM-dd'))
      setStartTime('09:00')
      setEndDate(format(date, 'yyyy-MM-dd'))
      setEndTime('10:00')
      setAllDay(false)
      setCalendarId(calendars[0]?.id || null)
      setColor(COLORS[0])
    }
    setError('')
    setConflicts([])
  }, [mode, event, defaultDate, calendars, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!calendarId) {
      setError('Please select a calendar')
      return
    }

    setIsLoading(true)
    setError('')

    const startDateTime = allDay
      ? `${startDate}T00:00:00`
      : `${startDate}T${startTime}:00`
    const endDateTime = allDay
      ? `${endDate}T23:59:59`
      : `${endDate}T${endTime}:00`

    try {
      if (mode === 'create') {
        const result = await createEvent({
          calendarId,
          title,
          description: description || undefined,
          location: location || undefined,
          startTime: startDateTime,
          endTime: endDateTime,
          allDay,
          color,
        })
        if (result.conflicts && result.conflicts.length > 0) {
          setConflicts(result.conflicts)
        }
        onEventCreated(result.event)
        onClose()
      } else if (event) {
        const result = await updateEvent(event.id, {
          calendarId,
          title,
          description: description || undefined,
          location: location || undefined,
          startTime: startDateTime,
          endTime: endDateTime,
          allDay,
          color,
        })
        if (result.conflicts && result.conflicts.length > 0) {
          setConflicts(result.conflicts)
        }
        onEventUpdated(result.event)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!event) return
    if (!confirm('Are you sure you want to delete this event?')) return

    setIsLoading(true)
    try {
      await deleteEvent(event.id)
      onEventDeleted(event.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'create' ? 'Create Event' : 'Edit Event'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-amber-700 mb-2">
                <ExclamationTriangleIcon className="w-5 h-5" />
                <span className="font-medium">Scheduling Conflicts</span>
              </div>
              <ul className="text-sm text-amber-600 space-y-1">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.title} ({format(new Date(c.start_time), 'h:mm a')} -{' '}
                    {format(new Date(c.end_time), 'h:mm a')})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <input
              type="text"
              placeholder="Add title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-3 text-xl border-0 border-b-2 border-gray-200 focus:border-blue-500 focus:ring-0 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            {!allDay && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            {!allDay && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">All day</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Calendar
            </label>
            <select
              value={calendarId || ''}
              onChange={(e) => setCalendarId(Number(e.target.value))}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select calendar</option>
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <input
              type="text"
              placeholder="Add location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              placeholder="Add description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Color
            </label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <TrashIcon className="w-5 h-5" />
                Delete
              </button>
            )}
            <div className={`flex gap-3 ${mode === 'create' ? 'ml-auto' : ''}`}>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
