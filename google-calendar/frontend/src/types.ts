export interface User {
  id: number
  username: string
  email: string
  timezone: string
}

export interface Calendar {
  id: number
  name: string
  color: string
  is_primary: boolean
  created_at: string
}

export interface CalendarEvent {
  id: number
  calendar_id: number
  title: string
  description?: string
  location?: string
  start_time: string
  end_time: string
  all_day: boolean
  color: string
  calendar_name?: string
  recurrence_rule?: string
  created_at: string
  updated_at: string
}

export interface ConflictingEvent {
  id: number
  title: string
  start_time: string
  end_time: string
  calendar_name: string
}
