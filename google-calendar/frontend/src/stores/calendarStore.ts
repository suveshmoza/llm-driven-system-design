import { create } from 'zustand'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  addWeeks,
  addDays,
  subMonths,
  subWeeks,
  subDays,
} from 'date-fns'
import type { Calendar, CalendarEvent } from '../types'

export type ViewType = 'month' | 'week' | 'day'

interface CalendarState {
  // View state
  currentDate: Date
  view: ViewType
  setCurrentDate: (date: Date) => void
  setView: (view: ViewType) => void

  // Navigation
  goToToday: () => void
  goToPrevious: () => void
  goToNext: () => void

  // Events
  events: CalendarEvent[]
  setEvents: (events: CalendarEvent[]) => void
  addEvent: (event: CalendarEvent) => void
  updateEvent: (event: CalendarEvent) => void
  removeEvent: (id: number) => void

  // Calendars
  calendars: Calendar[]
  setCalendars: (calendars: Calendar[]) => void
  visibleCalendarIds: Set<number>
  toggleCalendarVisibility: (id: number) => void

  // Modal state
  selectedEvent: CalendarEvent | null
  isModalOpen: boolean
  modalMode: 'create' | 'edit'
  modalDate: Date | null
  openCreateModal: (date?: Date) => void
  openEditModal: (event: CalendarEvent) => void
  closeModal: () => void

  // Computed helpers
  getViewDateRange: () => { start: Date; end: Date }
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  currentDate: new Date(),
  view: 'month',
  setCurrentDate: (date) => set({ currentDate: date }),
  setView: (view) => set({ view }),

  goToToday: () => set({ currentDate: new Date() }),
  goToPrevious: () => {
    const { currentDate, view } = get()
    const newDate =
      view === 'month'
        ? subMonths(currentDate, 1)
        : view === 'week'
          ? subWeeks(currentDate, 1)
          : subDays(currentDate, 1)
    set({ currentDate: newDate })
  },
  goToNext: () => {
    const { currentDate, view } = get()
    const newDate =
      view === 'month'
        ? addMonths(currentDate, 1)
        : view === 'week'
          ? addWeeks(currentDate, 1)
          : addDays(currentDate, 1)
    set({ currentDate: newDate })
  },

  events: [],
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
  updateEvent: (event) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === event.id ? event : e)),
    })),
  removeEvent: (id) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    })),

  calendars: [],
  setCalendars: (calendars) =>
    set({
      calendars,
      visibleCalendarIds: new Set(calendars.map((c) => c.id)),
    }),
  visibleCalendarIds: new Set(),
  toggleCalendarVisibility: (id) =>
    set((state) => {
      const newSet = new Set(state.visibleCalendarIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { visibleCalendarIds: newSet }
    }),

  selectedEvent: null,
  isModalOpen: false,
  modalMode: 'create',
  modalDate: null,
  openCreateModal: (date) =>
    set({
      isModalOpen: true,
      modalMode: 'create',
      selectedEvent: null,
      modalDate: date || new Date(),
    }),
  openEditModal: (event) =>
    set({
      isModalOpen: true,
      modalMode: 'edit',
      selectedEvent: event,
      modalDate: null,
    }),
  closeModal: () =>
    set({
      isModalOpen: false,
      selectedEvent: null,
      modalDate: null,
    }),

  getViewDateRange: () => {
    const { currentDate, view } = get()
    if (view === 'month') {
      const monthStart = startOfMonth(currentDate)
      const monthEnd = endOfMonth(currentDate)
      return {
        start: startOfWeek(monthStart),
        end: endOfWeek(monthEnd),
      }
    } else if (view === 'week') {
      return {
        start: startOfWeek(currentDate),
        end: endOfWeek(currentDate),
      }
    } else {
      // day view
      return {
        start: new Date(currentDate.setHours(0, 0, 0, 0)),
        end: new Date(currentDate.setHours(23, 59, 59, 999)),
      }
    }
  },
}))
