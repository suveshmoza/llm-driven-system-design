import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { setHours, setMinutes } from 'date-fns'
import { useAuthStore } from '../stores/authStore'
import { useCalendarStore } from '../stores/calendarStore'
import { getCalendars, getEvents } from '../services/api'
import {
  MonthView,
  WeekView,
  DayView,
  EventModal,
  ViewSwitcher,
  DateNavigator,
  CalendarSidebar,
} from '../components/calendar'
import type { CalendarEvent } from '../types'

function CalendarPage() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    goToToday,
    goToPrevious,
    goToNext,
    events,
    setEvents,
    addEvent,
    updateEvent,
    removeEvent,
    calendars,
    setCalendars,
    visibleCalendarIds,
    isModalOpen,
    modalMode,
    selectedEvent,
    modalDate,
    openCreateModal,
    openEditModal,
    closeModal,
    getViewDateRange,
  } = useCalendarStore()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' })
    }
  }, [user, navigate])

  // Load calendars
  useEffect(() => {
    if (user) {
      getCalendars()
        .then(({ calendars }) => setCalendars(calendars))
        .catch(console.error)
    }
  }, [user, setCalendars])

  // Load events when date range changes
  useEffect(() => {
    if (user && calendars.length > 0) {
      const { start, end } = getViewDateRange()
      getEvents(start, end)
        .then(({ events }) => setEvents(events))
        .catch(console.error)
    }
  }, [user, calendars, currentDate, view, getViewDateRange, setEvents])

  // Filter events by visible calendars
  const visibleEvents = useMemo(() => {
    return events.filter((event) => visibleCalendarIds.has(event.calendar_id))
  }, [events, visibleCalendarIds])

  const handleDayClick = (date: Date) => {
    if (view === 'month') {
      setCurrentDate(date)
      setView('day')
    } else {
      openCreateModal(date)
    }
  }

  const handleTimeSlotClick = (date: Date, hour: number) => {
    const eventDate = setMinutes(setHours(date, hour), 0)
    openCreateModal(eventDate)
  }

  const handleEventClick = (event: CalendarEvent) => {
    openEditModal(event)
  }

  const handleEventCreated = (event: CalendarEvent) => {
    addEvent(event)
  }

  const handleEventUpdated = (event: CalendarEvent) => {
    updateEvent(event)
  }

  const handleEventDeleted = (id: number) => {
    removeEvent(id)
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <CalendarSidebar onCreateEvent={() => openCreateModal()} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <DateNavigator
            currentDate={currentDate}
            view={view}
            onPrevious={goToPrevious}
            onNext={goToNext}
            onToday={goToToday}
          />
          <ViewSwitcher view={view} onViewChange={setView} />
        </div>

        {/* Calendar View */}
        <div className="flex-1 overflow-hidden bg-white">
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={visibleEvents}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}
          {view === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={visibleEvents}
              onTimeSlotClick={handleTimeSlotClick}
              onEventClick={handleEventClick}
            />
          )}
          {view === 'day' && (
            <DayView
              currentDate={currentDate}
              events={visibleEvents}
              onTimeSlotClick={handleTimeSlotClick}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {/* Event Modal */}
      <EventModal
        isOpen={isModalOpen}
        mode={modalMode}
        event={selectedEvent}
        defaultDate={modalDate}
        onClose={closeModal}
        onEventCreated={handleEventCreated}
        onEventUpdated={handleEventUpdated}
        onEventDeleted={handleEventDeleted}
      />
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: CalendarPage,
})
