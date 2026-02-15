import { create } from 'zustand';
import type { App, AppComponent, AppQuery, ComponentDefinition } from '../types';
import { appsApi, componentsApi } from '../services/api';

interface EditorState {
  // App state
  app: App | null;
  isDirty: boolean;

  // Component palette
  componentDefinitions: ComponentDefinition[];

  // Selection
  selectedComponentId: string | null;

  // Query panel
  queryPanelOpen: boolean;
  selectedQueryId: string | null;

  // Actions
  loadApp: (appId: string) => Promise<void>;
  loadComponentDefinitions: () => Promise<void>;
  saveApp: () => Promise<void>;

  // Component actions
  addComponent: (definition: ComponentDefinition, position?: { x: number; y: number }) => void;
  updateComponent: (id: string, updates: Partial<AppComponent>) => void;
  removeComponent: (id: string) => void;
  selectComponent: (id: string | null) => void;
  moveComponent: (id: string, position: { x: number; y: number }) => void;
  resizeComponent: (id: string, size: { w: number; h: number }) => void;

  // Query actions
  addQuery: (query: AppQuery) => void;
  updateQuery: (id: string, updates: Partial<AppQuery>) => void;
  removeQuery: (id: string) => void;
  selectQuery: (id: string | null) => void;
  toggleQueryPanel: () => void;

  // App metadata
  updateAppName: (name: string) => void;
  publishApp: () => Promise<void>;
}

let componentIdCounter = 0;

/** Editor state for the visual app builder with component selection and layout. */
export const useEditorStore = create<EditorState>((set, get) => ({
  app: null,
  isDirty: false,
  componentDefinitions: [],
  selectedComponentId: null,
  queryPanelOpen: true,
  selectedQueryId: null,

  loadApp: async (appId: string) => {
    try {
      const { app } = await appsApi.get(appId);
      // Normalize from snake_case API response
      const normalized: App = {
        id: app.id,
        name: app.name,
        description: app.description || '',
        components: (app.components || []) as AppComponent[],
        layout: (app.layout || {}) as Record<string, unknown>,
        queries: (app.queries || []) as AppQuery[],
        status: app.status || 'draft',
        publishedVersion: app.publishedVersion,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
      };
      set({ app: normalized, isDirty: false, selectedComponentId: null, selectedQueryId: null });
    } catch (err) {
      console.error('Failed to load app:', err);
    }
  },

  loadComponentDefinitions: async () => {
    try {
      const { components } = await componentsApi.list();
      set({ componentDefinitions: components });
    } catch (err) {
      console.error('Failed to load component definitions:', err);
    }
  },

  saveApp: async () => {
    const { app } = get();
    if (!app) return;

    try {
      await appsApi.update(app.id, {
        name: app.name,
        description: app.description,
        components: app.components,
        layout: app.layout,
        queries: app.queries,
      });
      set({ isDirty: false });
    } catch (err) {
      console.error('Failed to save app:', err);
    }
  },

  addComponent: (definition, position) => {
    const { app } = get();
    if (!app) return;

    componentIdCounter++;
    const id = `${definition.type}${componentIdCounter}`;

    const newComponent: AppComponent = {
      id,
      type: definition.type,
      props: { ...definition.defaultProps },
      position: {
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        w: definition.type === 'table' ? 12 : definition.type === 'chart' ? 6 : 4,
        h: definition.type === 'table' ? 8 : definition.type === 'chart' ? 6 : 2,
      },
      bindings: {},
    };

    set({
      app: {
        ...app,
        components: [...app.components, newComponent],
      },
      isDirty: true,
      selectedComponentId: id,
    });
  },

  updateComponent: (id, updates) => {
    const { app } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        components: app.components.map((c) =>
          c.id === id ? { ...c, ...updates } : c,
        ),
      },
      isDirty: true,
    });
  },

  removeComponent: (id) => {
    const { app, selectedComponentId } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        components: app.components.filter((c) => c.id !== id),
      },
      isDirty: true,
      selectedComponentId: selectedComponentId === id ? null : selectedComponentId,
    });
  },

  selectComponent: (id) => {
    set({ selectedComponentId: id });
  },

  moveComponent: (id, position) => {
    const { app } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        components: app.components.map((c) =>
          c.id === id ? { ...c, position: { ...c.position, ...position } } : c,
        ),
      },
      isDirty: true,
    });
  },

  resizeComponent: (id, size) => {
    const { app } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        components: app.components.map((c) =>
          c.id === id ? { ...c, position: { ...c.position, ...size } } : c,
        ),
      },
      isDirty: true,
    });
  },

  addQuery: (query) => {
    const { app } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        queries: [...app.queries, query],
      },
      isDirty: true,
      selectedQueryId: query.id,
    });
  },

  updateQuery: (id, updates) => {
    const { app } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        queries: app.queries.map((q) =>
          q.id === id ? { ...q, ...updates } : q,
        ),
      },
      isDirty: true,
    });
  },

  removeQuery: (id) => {
    const { app, selectedQueryId } = get();
    if (!app) return;

    set({
      app: {
        ...app,
        queries: app.queries.filter((q) => q.id !== id),
      },
      isDirty: true,
      selectedQueryId: selectedQueryId === id ? null : selectedQueryId,
    });
  },

  selectQuery: (id) => {
    set({ selectedQueryId: id });
  },

  toggleQueryPanel: () => {
    set((state) => ({ queryPanelOpen: !state.queryPanelOpen }));
  },

  updateAppName: (name) => {
    const { app } = get();
    if (!app) return;

    set({
      app: { ...app, name },
      isDirty: true,
    });
  },

  publishApp: async () => {
    const { app, saveApp } = get();
    if (!app) return;

    // Save first
    await saveApp();

    try {
      const result = await appsApi.publish(app.id);
      set({
        app: {
          ...app,
          status: 'published',
          publishedVersion: result.version,
        },
      });
    } catch (err) {
      console.error('Failed to publish app:', err);
      throw err;
    }
  },
}));
