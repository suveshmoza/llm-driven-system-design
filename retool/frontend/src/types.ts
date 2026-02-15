export interface AppComponent {
  id: string;
  type: string;
  props: Record<string, unknown>;
  position: { x: number; y: number; w: number; h: number };
  bindings: Record<string, string>;
}

export interface AppQuery {
  id: string;
  name: string;
  dataSourceId: string;
  queryText: string;
  transformJs?: string;
  trigger: 'manual' | 'on_load' | 'on_change';
}

export interface App {
  id: string;
  name: string;
  description: string;
  components: AppComponent[];
  layout: Record<string, unknown>;
  queries: AppQuery[];
  status: 'draft' | 'published';
  publishedVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: string;
  name: string;
  type: 'postgresql' | 'rest_api';
  config: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataType: string }[];
  rowCount: number;
  error?: string;
}

export interface ComponentDefinition {
  type: string;
  label: string;
  icon: string;
  category: string;
  defaultProps: Record<string, unknown>;
  propSchema: { name: string; type: string; label: string; bindable?: boolean }[];
}

export interface User {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  role: string;
}
