/**
 * Type declarations for 'pg' module.
 * This provides minimal types until @types/pg is installed via npm install.
 */
declare module 'pg' {
  export interface PoolConfig {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface QueryResultRow {}

  export interface QueryResult<R = QueryResultRow> {
    rows: R[];
    rowCount: number | null;
    command: string;
    oid: number;
    fields: FieldDef[];
  }

  export interface FieldDef {
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
    dataTypeSize: number;
    dataTypeModifier: number;
    format: string;
  }

  export interface PoolClient {
    query<R = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    release(err?: Error | boolean): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<R = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: 'error', listener: (err: Error, client: PoolClient) => void): this;
    on(event: 'connect' | 'acquire' | 'remove', listener: (client: PoolClient) => void): this;
  }

  const pg: {
    Pool: typeof Pool;
  };

  export default pg;
}
