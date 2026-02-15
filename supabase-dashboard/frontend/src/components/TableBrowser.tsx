import { useEffect, useState, useCallback } from 'react';
import type { ColumnInfo } from '../types';
import { useProjectStore } from '../stores/projectStore';
import { DataRow } from './DataRow';

interface TableBrowserProps {
  projectId: string;
  tableName: string;
  columns: ColumnInfo[];
}

/** Renders a paginated, sortable data grid with inline editing, row insert, and delete. */
export function TableBrowser({ projectId, tableName, columns }: TableBrowserProps) {
  const { tableData, tableDataLoading, loadTableData, insertRow, updateRow, deleteRow } = useProjectStore();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showInsert, setShowInsert] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    loadTableData(projectId, tableName, page, 50, sortBy || undefined, sortOrder);
  }, [projectId, tableName, page, sortBy, sortOrder, loadTableData]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const pkColumn = columns.find((c) => c.isPrimaryKey)?.name || 'id';
  const fieldNames = tableData?.fields.map((f) => f.name) || columns.map((c) => c.name);

  const handleInsert = async () => {
    try {
      await insertRow(projectId, tableName, newRowData);
      setShowInsert(false);
      setNewRowData({});
      refresh();
    } catch {
      // error
    }
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    await updateRow(projectId, tableName, id, data, pkColumn);
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this row?')) {
      await deleteRow(projectId, tableName, id, pkColumn);
      refresh();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-supabase-border px-4 py-3 flex items-center justify-between bg-supabase-dark-surface">
        <h3 className="text-sm font-medium text-supabase-text">{tableName}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="text-supabase-secondary hover:text-supabase-text text-sm px-3 py-1 border border-supabase-border rounded"
          >
            Refresh
          </button>
          <button
            onClick={() => setShowInsert(!showInsert)}
            className="bg-supabase-primary hover:bg-supabase-hover text-black px-3 py-1 rounded text-sm font-medium transition-colors"
          >
            Insert Row
          </button>
        </div>
      </div>

      {/* Insert row form */}
      {showInsert && (
        <div className="border-b border-supabase-border p-4 bg-supabase-surface">
          <div className="grid grid-cols-3 gap-3 mb-3">
            {fieldNames.filter((f) => f !== pkColumn || !columns.find((c) => c.name === f)?.columnDefault).map((field) => (
              <div key={field}>
                <label className="text-xs text-supabase-secondary mb-1 block">{field}</label>
                <input
                  type="text"
                  value={newRowData[field] || ''}
                  onChange={(e) => setNewRowData({ ...newRowData, [field]: e.target.value })}
                  className="w-full bg-supabase-dark-surface border border-supabase-border rounded px-2 py-1 text-sm text-supabase-text focus:outline-none focus:border-supabase-primary"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleInsert}
              className="bg-supabase-primary hover:bg-supabase-hover text-black px-3 py-1 rounded text-sm font-medium transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowInsert(false); setNewRowData({}); }}
              className="text-supabase-secondary hover:text-supabase-text text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {tableDataLoading ? (
          <div className="p-4 text-sm text-supabase-secondary">Loading...</div>
        ) : !tableData || tableData.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-supabase-secondary">
            No rows found
          </div>
        ) : (
          <table className="w-full text-sm table-browser">
            <thead className="sticky top-0">
              <tr>
                {fieldNames.map((field) => (
                  <th
                    key={field}
                    className="text-left px-4 py-2 cursor-pointer select-none whitespace-nowrap"
                    onClick={() => handleSort(field)}
                  >
                    <span className="flex items-center gap-1">
                      {field}
                      {sortBy === field && (
                        <span>{sortOrder === 'asc' ? '\u25B2' : '\u25BC'}</span>
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {tableData.rows.map((row, i) => (
                <DataRow
                  key={String(row[pkColumn] ?? i)}
                  row={row}
                  fields={fieldNames}
                  pkColumn={pkColumn}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {tableData && tableData.totalPages > 1 && (
        <div className="border-t border-supabase-border px-4 py-3 flex items-center justify-between bg-supabase-dark-surface">
          <span className="text-xs text-supabase-secondary">
            {tableData.total} rows &middot; Page {tableData.page} of {tableData.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="text-sm text-supabase-secondary hover:text-supabase-text disabled:opacity-50 px-2 py-1 border border-supabase-border rounded"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(Math.min(tableData.totalPages, page + 1))}
              disabled={page >= tableData.totalPages}
              className="text-sm text-supabase-secondary hover:text-supabase-text disabled:opacity-50 px-2 py-1 border border-supabase-border rounded"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
