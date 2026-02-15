import { useState } from 'react';
import { ColumnEditor } from './ColumnEditor';

interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
}

interface CreateTableModalProps {
  onClose: () => void;
  onCreate: (tableName: string, columns: Column[]) => Promise<void>;
}

/** Modal for creating a new database table with dynamic column definition. */
export function CreateTableModal({ onClose, onCreate }: CreateTableModalProps) {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<Column[]>([
    { name: 'id', type: 'SERIAL', primaryKey: true },
    { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()' },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const addColumn = () => {
    setColumns([...columns, { name: '', type: 'TEXT', nullable: true }]);
  };

  const removeColumn = (index: number) => {
    setColumns(columns.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, col: Column) => {
    const updated = [...columns];
    updated[index] = col;
    setColumns(updated);
  };

  const handleCreate = async () => {
    if (!tableName.trim()) {
      setError('Table name is required');
      return;
    }
    if (columns.some((c) => !c.name.trim() || !c.type.trim())) {
      setError('All columns must have a name and type');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await onCreate(tableName, columns);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create table');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-supabase-surface border border-supabase-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-supabase-border">
          <h3 className="text-lg font-semibold text-supabase-text">Create New Table</h3>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-supabase-secondary mb-1">Table Name</label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="w-full bg-supabase-dark-surface border border-supabase-border rounded px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
              placeholder="my_table"
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-supabase-secondary">Columns</label>
              <button onClick={addColumn} className="text-supabase-primary text-sm hover:text-supabase-hover">
                + Add Column
              </button>
            </div>
            <div className="space-y-2">
              {columns.map((col, i) => (
                <ColumnEditor
                  key={i}
                  column={col}
                  onChange={(c) => updateColumn(i, c)}
                  onRemove={() => removeColumn(i)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-supabase-border flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-supabase-secondary hover:text-supabase-text">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="bg-supabase-primary hover:bg-supabase-hover text-black px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating...' : 'Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}
