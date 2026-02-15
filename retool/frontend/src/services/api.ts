import type { App, AppComponent, AppQuery, ComponentDefinition, DataSource, QueryResult, User } from '../types';

const BASE_URL = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
/** API methods for user authentication (login, register, logout, session check). */
export const authApi = {
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, email: string, password: string, displayName?: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, displayName }),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: User }>('/auth/me'),
};

// Apps
/** API methods for CRUD operations on low-code applications. */
export const appsApi = {
  list: () =>
    request<{ apps: App[] }>('/apps'),

  get: (id: string) =>
    request<{ app: App }>(`/apps/${id}`),

  create: (name: string, description?: string) =>
    request<{ app: App }>('/apps', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  update: (id: string, data: {
    name?: string;
    description?: string;
    components?: AppComponent[];
    layout?: Record<string, unknown>;
    queries?: AppQuery[];
  }) =>
    request<{ app: App }>(`/apps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/apps/${id}`, { method: 'DELETE' }),

  publish: (id: string) =>
    request<{ message: string; version: number }>(`/apps/${id}/publish`, { method: 'POST' }),

  preview: (id: string) =>
    request<{ app: App }>(`/apps/${id}/preview`),

  versions: (id: string) =>
    request<{ versions: unknown[] }>(`/apps/${id}/versions`),
};

// Components
/** API methods for fetching widget type definitions from the component registry. */
export const componentsApi = {
  list: () =>
    request<{ components: ComponentDefinition[] }>('/components'),

  get: (type: string) =>
    request<{ component: ComponentDefinition }>(`/components/${type}`),
};

// Data Sources
/** API methods for managing external database connections. */
export const dataSourcesApi = {
  list: () =>
    request<{ dataSources: DataSource[] }>('/datasources'),

  get: (id: string) =>
    request<{ dataSource: DataSource }>(`/datasources/${id}`),

  create: (name: string, type: string, config: Record<string, unknown>) =>
    request<{ dataSource: DataSource }>('/datasources', {
      method: 'POST',
      body: JSON.stringify({ name, type, config }),
    }),

  update: (id: string, data: { name?: string; config?: Record<string, unknown> }) =>
    request<{ dataSource: DataSource }>(`/datasources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/datasources/${id}`, { method: 'DELETE' }),

  test: (id: string) =>
    request<{ success: boolean; error?: string }>(`/datasources/${id}/test`, { method: 'POST' }),
};

// Queries
/** API methods for executing and managing saved data source queries. */
export const queriesApi = {
  execute: (dataSourceId: string, queryText: string, context?: Record<string, unknown>, allowWrite?: boolean) =>
    request<QueryResult>('/queries/execute', {
      method: 'POST',
      body: JSON.stringify({ dataSourceId, queryText, context, allowWrite }),
    }),

  listSaved: (appId: string) =>
    request<{ queries: unknown[] }>(`/queries/saved/${appId}`),

  createSaved: (data: {
    appId: string;
    name: string;
    dataSourceId?: string;
    queryText?: string;
    trigger?: string;
  }) =>
    request<{ query: unknown }>('/queries/saved', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
