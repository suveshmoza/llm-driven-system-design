const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export function register(username: string, email: string, password: string, displayName?: string) {
  return request<{ user: { id: string; username: string; email: string; displayName: string } }>(
    '/auth/register',
    { method: 'POST', body: JSON.stringify({ username, email, password, displayName }) }
  );
}

export function login(username: string, password: string) {
  return request<{ user: { id: string; username: string; email: string; displayName: string } }>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) }
  );
}

export function logout() {
  return request<{ message: string }>('/auth/logout', { method: 'POST' });
}

export function getMe() {
  return request<{ user: { id: string; username: string; email: string; displayName: string; avatarUrl?: string } }>(
    '/auth/me'
  );
}

// Meetings
export function createMeeting(data: {
  title?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  settings?: {
    waitingRoom?: boolean;
    muteOnEntry?: boolean;
    allowScreenShare?: boolean;
    maxParticipants?: number;
  };
}) {
  return request<{ meeting: Record<string, unknown> }>('/meetings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getMeetings() {
  return request<{ meetings: Record<string, unknown>[] }>('/meetings');
}

export function getMeetingByCode(code: string) {
  return request<{ meeting: Record<string, unknown> }>(`/meetings/code/${code}`);
}

export function getMeetingById(id: string) {
  return request<{ meeting: Record<string, unknown> }>(`/meetings/${id}`);
}

export function startMeeting(id: string) {
  return request<{ meeting: Record<string, unknown> }>(`/meetings/${id}/start`, { method: 'POST' });
}

export function endMeeting(id: string) {
  return request<{ meeting: Record<string, unknown> }>(`/meetings/${id}/end`, { method: 'POST' });
}

export function getParticipants(meetingId: string) {
  return request<{ participants: Record<string, unknown>[] }>(`/meetings/${meetingId}/participants`);
}

// Chat
export function getChatMessages(meetingId: string, limit?: number) {
  const query = limit ? `?limit=${limit}` : '';
  return request<{ messages: Record<string, unknown>[] }>(`/chat/${meetingId}/messages${query}`);
}

export function sendChatMessage(meetingId: string, content: string, recipientId?: string) {
  return request<{ message: Record<string, unknown> }>(`/chat/${meetingId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, recipientId }),
  });
}

// Breakout Rooms
export function createBreakoutRooms(meetingId: string, rooms: { name: string }[]) {
  return request<{ rooms: Record<string, unknown>[] }>(`/rooms/${meetingId}/breakout-rooms`, {
    method: 'POST',
    body: JSON.stringify({ rooms }),
  });
}

export function getBreakoutRooms(meetingId: string) {
  return request<{ rooms: Record<string, unknown>[] }>(`/rooms/${meetingId}/breakout-rooms`);
}

export function activateBreakoutRooms(meetingId: string) {
  return request<{ message: string }>(`/rooms/${meetingId}/breakout-rooms/activate`, { method: 'POST' });
}

export function closeBreakoutRooms(meetingId: string) {
  return request<{ message: string }>(`/rooms/${meetingId}/breakout-rooms/close`, { method: 'POST' });
}
