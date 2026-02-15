interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
}

interface ColumnEditorProps {
  column: Column;
  onChange: (column: Column) => void;
  onRemove: () => void;
}

const PG_TYPES = [
  'SERIAL', 'BIGSERIAL', 'INTEGER', 'BIGINT', 'SMALLINT',
  'TEXT', 'VARCHAR(255)', 'CHAR(1)',
  'BOOLEAN',
  'TIMESTAMPTZ', 'TIMESTAMP', 'DATE', 'TIME',
  'UUID', 'JSONB', 'JSON',
  'NUMERIC', 'REAL', 'DOUBLE PRECISION',
  'BYTEA',
];

export function ColumnEditor({ column, onChange, onRemove }: ColumnEditorProps) {
  return (
    <div className="flex items-center gap-2 bg-supabase-dark-surface border border-supabase-dark-border rounded p-2">
      <input
        type="text"
        value={column.name}
        onChange={(e) => onChange({ ...column, name: e.target.value })}
        className="flex-1 bg-transparent border border-supabase-border rounded px-2 py-1 text-sm text-supabase-text focus:outline-none focus:border-supabase-primary"
        placeholder="column_name"
      />
      <select
        value={column.type}
        onChange={(e) => onChange({ ...column, type: e.target.value })}
        className="bg-supabase-surface border border-supabase-border rounded px-2 py-1 text-sm text-supabase-text focus:outline-none focus:border-supabase-primary"
      >
        {PG_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-supabase-secondary whitespace-nowrap">
        <input
          type="checkbox"
          checked={column.primaryKey || false}
          onChange={(e) => onChange({ ...column, primaryKey: e.target.checked })}
          className="accent-supabase-primary"
        />
        PK
      </label>
      <label className="flex items-center gap-1 text-xs text-supabase-secondary whitespace-nowrap">
        <input
          type="checkbox"
          checked={column.nullable || false}
          onChange={(e) => onChange({ ...column, nullable: e.target.checked })}
          className="accent-supabase-primary"
        />
        Null
      </label>
      <input
        type="text"
        value={column.defaultValue || ''}
        onChange={(e) => onChange({ ...column, defaultValue: e.target.value })}
        className="w-24 bg-transparent border border-supabase-border rounded px-2 py-1 text-sm text-supabase-text focus:outline-none focus:border-supabase-primary"
        placeholder="Default"
      />
      <button
        onClick={onRemove}
        className="text-supabase-secondary hover:text-supabase-danger text-sm px-1"
        title="Remove column"
      >
        &times;
      </button>
    </div>
  );
}
