import type { User, Calendar, CalendarEvent, ConflictingEvent } from '../types'

const API_BASE = '/api'

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }
  return response.json()
}

// Auth
export async function login(username: string, password: string): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  })
  return handleResponse(res)
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}

export async function getMe(): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: 'include',
  })
  return handleResponse(res)
}

// Calendars
export async function getCalendars(): Promise<{ calendars: Calendar[] }> {
  const res = await fetch(`${API_BASE}/calendars`, {
    credentials: 'include',
  })
  return handleResponse(res)
}

export async function createCalendar(name: string, color: string): Promise<{ calendar: Calendar }> {
  const res = await fetch(`${API_BASE}/calendars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, color }),
  })
  return handleResponse(res)
}

// Events
export async function getEvents(start: Date, end: Date): Promise<{ events: CalendarEvent[] }> {
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  })
  const res = await fetch(`${API_BASE}/events?${params}`, {
    credentials: 'include',
  })
  return handleResponse(res)
}

export async function getEvent(id: number): Promise<{ event: CalendarEvent }> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    credentials: 'include',
  })
  return handleResponse(res)
}

export async function createEvent(event: {
  calendarId: number
  title: string
  description?: string
  location?: string
  startTime: string
  endTime: string
  allDay?: boolean
  color?: string
}): Promise<{ event: CalendarEvent; conflicts?: ConflictingEvent[] }> {
  const res = await fetch(`${API_BASE}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(event),
  })
  return handleResponse(res)
}

export async function updateEvent(
  id: number,
  event: Partial<{
    calendarId: number
    title: string
    description?: string
    location?: string
    startTime: string
    endTime: string
    allDay?: boolean
    color?: string
  }>
): Promise<{ event: CalendarEvent; conflicts?: ConflictingEvent[] }> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(event),
  })
  return handleResponse(res)
}

export async function deleteEvent(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Delete failed' }))
    throw new Error(error.error || 'Delete failed')
  }
}
