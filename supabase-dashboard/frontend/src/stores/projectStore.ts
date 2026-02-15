import { create } from 'zustand';
import type { Project, TableInfo, QueryResult, SavedQuery, AuthUser, TableDataResponse, ProjectSettings } from '../types';
import { projectsApi, tablesApi, tableDataApi, sqlApi, authUsersApi, settingsApi } from '../services/api';

interface ProjectState {
  // Projects
  projects: Project[];
  currentProject: Project | null;
  projectsLoading: boolean;

  // Tables
  tables: TableInfo[];
  tablesLoading: boolean;

  // Table Data
  tableData: TableDataResponse | null;
  tableDataLoading: boolean;

  // SQL
  queryResult: QueryResult | null;
  queryError: string | null;
  queryLoading: boolean;
  savedQueries: SavedQuery[];

  // Auth Users
  authUsers: AuthUser[];
  authUsersLoading: boolean;

  // Settings
  settings: ProjectSettings | null;
  settingsLoading: boolean;

  // Actions - Projects
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (data: { name: string; description?: string }) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  // Actions - Tables
  loadTables: (projectId: string) => Promise<void>;
  createTable: (projectId: string, tableName: string, columns: { name: string; type: string; nullable?: boolean; defaultValue?: string; primaryKey?: boolean }[]) => Promise<void>;
  dropTable: (projectId: string, tableName: string) => Promise<void>;

  // Actions - Table Data
  loadTableData: (projectId: string, tableName: string, page?: number, limit?: number, sortBy?: string, sortOrder?: string) => Promise<void>;
  insertRow: (projectId: string, tableName: string, data: Record<string, unknown>) => Promise<void>;
  updateRow: (projectId: string, tableName: string, id: string, data: Record<string, unknown>, primaryKey?: string) => Promise<void>;
  deleteRow: (projectId: string, tableName: string, id: string, primaryKey?: string) => Promise<void>;

  // Actions - SQL
  executeQuery: (projectId: string, sql: string) => Promise<void>;
  loadSavedQueries: (projectId: string) => Promise<void>;
  saveQuery: (projectId: string, name: string, queryText: string) => Promise<void>;
  deleteSavedQuery: (projectId: string, queryId: string) => Promise<void>;
  clearQueryResult: () => void;

  // Actions - Auth Users
  loadAuthUsers: (projectId: string) => Promise<void>;
  createAuthUser: (projectId: string, data: { email: string; password?: string; role?: string; emailConfirmed?: boolean }) => Promise<void>;
  updateAuthUser: (projectId: string, userId: string, data: { email?: string; password?: string; role?: string; emailConfirmed?: boolean }) => Promise<void>;
  deleteAuthUser: (projectId: string, userId: string) => Promise<void>;

  // Actions - Settings
  loadSettings: (projectId: string) => Promise<void>;
  updateSettings: (projectId: string, data: Partial<ProjectSettings & { dbPassword?: string }>) => Promise<void>;
}

/** Central project state managing projects, tables, table data, SQL queries, auth users, and settings. */
export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  projectsLoading: false,
  tables: [],
  tablesLoading: false,
  tableData: null,
  tableDataLoading: false,
  queryResult: null,
  queryError: null,
  queryLoading: false,
  savedQueries: [],
  authUsers: [],
  authUsersLoading: false,
  settings: null,
  settingsLoading: false,

  // Projects
  loadProjects: async () => {
    set({ projectsLoading: true });
    try {
      const { projects } = await projectsApi.list();
      set({ projects, projectsLoading: false });
    } catch {
      set({ projectsLoading: false });
    }
  },

  loadProject: async (id) => {
    try {
      const { project } = await projectsApi.get(id);
      set({ currentProject: project });
    } catch {
      set({ currentProject: null });
    }
  },

  createProject: async (data) => {
    const { project } = await projectsApi.create(data);
    const projects = get().projects;
    set({ projects: [project, ...projects] });
    return project;
  },

  deleteProject: async (id) => {
    await projectsApi.delete(id);
    const projects = get().projects.filter((p) => p.id !== id);
    set({ projects });
  },

  // Tables
  loadTables: async (projectId) => {
    set({ tablesLoading: true });
    try {
      const { tables } = await tablesApi.list(projectId);
      set({ tables, tablesLoading: false });
    } catch {
      set({ tables: [], tablesLoading: false });
    }
  },

  createTable: async (projectId, tableName, columns) => {
    await tablesApi.create(projectId, tableName, columns);
    await get().loadTables(projectId);
  },

  dropTable: async (projectId, tableName) => {
    await tablesApi.drop(projectId, tableName);
    await get().loadTables(projectId);
  },

  // Table Data
  loadTableData: async (projectId, tableName, page, limit, sortBy, sortOrder) => {
    set({ tableDataLoading: true });
    try {
      const data = await tableDataApi.getRows(projectId, tableName, page, limit, sortBy, sortOrder);
      set({ tableData: data, tableDataLoading: false });
    } catch {
      set({ tableData: null, tableDataLoading: false });
    }
  },

  insertRow: async (projectId, tableName, data) => {
    await tableDataApi.insertRow(projectId, tableName, data);
  },

  updateRow: async (projectId, tableName, id, data, primaryKey) => {
    await tableDataApi.updateRow(projectId, tableName, id, data, primaryKey);
  },

  deleteRow: async (projectId, tableName, id, primaryKey) => {
    await tableDataApi.deleteRow(projectId, tableName, id, primaryKey);
  },

  // SQL
  executeQuery: async (projectId, sql) => {
    set({ queryLoading: true, queryError: null });
    try {
      const result = await sqlApi.execute(projectId, sql);
      set({ queryResult: result, queryLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed';
      set({ queryError: message, queryLoading: false, queryResult: null });
    }
  },

  loadSavedQueries: async (projectId) => {
    try {
      const { queries } = await sqlApi.listSaved(projectId);
      set({ savedQueries: queries });
    } catch {
      set({ savedQueries: [] });
    }
  },

  saveQuery: async (projectId, name, queryText) => {
    const { query } = await sqlApi.saveQuery(projectId, name, queryText);
    const savedQueries = get().savedQueries;
    set({ savedQueries: [query, ...savedQueries] });
  },

  deleteSavedQuery: async (projectId, queryId) => {
    await sqlApi.deleteSaved(projectId, queryId);
    const savedQueries = get().savedQueries.filter((q) => q.id !== queryId);
    set({ savedQueries });
  },

  clearQueryResult: () => set({ queryResult: null, queryError: null }),

  // Auth Users
  loadAuthUsers: async (projectId) => {
    set({ authUsersLoading: true });
    try {
      const { users } = await authUsersApi.list(projectId);
      set({ authUsers: users, authUsersLoading: false });
    } catch {
      set({ authUsers: [], authUsersLoading: false });
    }
  },

  createAuthUser: async (projectId, data) => {
    await authUsersApi.create(projectId, data);
    await get().loadAuthUsers(projectId);
  },

  updateAuthUser: async (projectId, userId, data) => {
    await authUsersApi.update(projectId, userId, data);
    await get().loadAuthUsers(projectId);
  },

  deleteAuthUser: async (projectId, userId) => {
    await authUsersApi.delete(projectId, userId);
    await get().loadAuthUsers(projectId);
  },

  // Settings
  loadSettings: async (projectId) => {
    set({ settingsLoading: true });
    try {
      const { settings } = await settingsApi.get(projectId);
      set({ settings, settingsLoading: false });
    } catch {
      set({ settings: null, settingsLoading: false });
    }
  },

  updateSettings: async (projectId, data) => {
    const { settings } = await settingsApi.update(projectId, data);
    set({ settings });
  },
}));
