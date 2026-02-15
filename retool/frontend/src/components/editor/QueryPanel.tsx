import { useState, useCallback } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useDataStore } from '../../stores/dataStore';
import { DataSourceForm } from '../DataSourceForm';

export function QueryPanel() {
  const app = useEditorStore((s) => s.app);
  const selectedQueryId = useEditorStore((s) => s.selectedQueryId);
  const selectQuery = useEditorStore((s) => s.selectQuery);
  const addQuery = useEditorStore((s) => s.addQuery);
  const updateQuery = useEditorStore((s) => s.updateQuery);
  const removeQuery = useEditorStore((s) => s.removeQuery);
  const toggleQueryPanel = useEditorStore((s) => s.toggleQueryPanel);

  const dataSources = useDataStore((s) => s.dataSources);
  const queryResults = useDataStore((s) => s.queryResults);
  const queryLoading = useDataStore((s) => s.queryLoading);
  const executeQuery = useDataStore((s) => s.executeQuery);

  const [showDataSourceForm, setShowDataSourceForm] = useState(false);

  const selectedQuery = app?.queries.find((q) => q.id === selectedQueryId);

  const handleAddQuery = useCallback(() => {
    const queryNum = (app?.queries.length ?? 0) + 1;
    const newQuery = {
      id: `query${queryNum}`,
      name: `query${queryNum}`,
      dataSourceId: dataSources[0]?.id || '',
      queryText: 'SELECT * FROM customers LIMIT 10',
      trigger: 'manual' as const,
    };
    addQuery(newQuery);
  }, [app, dataSources, addQuery]);

  const handleRunQuery = useCallback(async () => {
    if (!selectedQuery) return;
    await executeQuery(
      selectedQuery.name,
      selectedQuery.dataSourceId,
      selectedQuery.queryText,
    );
  }, [selectedQuery, executeQuery]);

  const currentResult = selectedQuery ? queryResults[selectedQuery.name] : null;
  const isLoading = selectedQuery ? queryLoading[selectedQuery.name] : false;

  return (
    <div className="flex h-full bg-white">
      {/* Query list sidebar */}
      <div className="w-48 border-r border-retool-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-retool-border">
          <span className="text-xs font-semibold text-retool-secondary uppercase">Queries</span>
          <div className="flex gap-1">
            <button
              onClick={handleAddQuery}
              className="text-xs text-retool-primary hover:text-retool-hover font-medium"
              title="Add query"
            >
              +
            </button>
            <button
              onClick={toggleQueryPanel}
              className="text-xs text-retool-secondary hover:text-retool-text"
              title="Close panel"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {app?.queries.map((query) => (
            <div
              key={query.id}
              className={`px-3 py-2 cursor-pointer text-sm border-b border-retool-border ${
                selectedQueryId === query.id
                  ? 'bg-retool-primary/10 text-retool-primary font-medium'
                  : 'text-retool-text hover:bg-retool-bg'
              }`}
              onClick={() => selectQuery(query.id)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{query.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQuery(query.id);
                  }}
                  className="text-xs text-retool-secondary hover:text-red-500 opacity-0 group-hover:opacity-100"
                >
                  &times;
                </button>
              </div>
              <div className="text-xs text-retool-secondary mt-0.5">{query.trigger}</div>
            </div>
          ))}

          {(!app?.queries || app.queries.length === 0) && (
            <div className="px-3 py-4 text-xs text-retool-secondary text-center">
              No queries yet
            </div>
          )}
        </div>

        <div className="border-t border-retool-border px-3 py-2">
          <button
            onClick={() => setShowDataSourceForm(true)}
            className="text-xs text-retool-primary hover:text-retool-hover"
          >
            + Data Source
          </button>
        </div>
      </div>

      {/* Query editor */}
      <div className="flex-1 flex flex-col">
        {selectedQuery ? (
          <>
            {/* Query toolbar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-retool-border">
              <input
                type="text"
                value={selectedQuery.name}
                onChange={(e) => updateQuery(selectedQuery.id, { name: e.target.value })}
                className="text-sm font-medium border border-retool-border rounded px-2 py-1 w-32"
              />

              <select
                value={selectedQuery.dataSourceId}
                onChange={(e) => updateQuery(selectedQuery.id, { dataSourceId: e.target.value })}
                className="text-sm border border-retool-border rounded px-2 py-1"
              >
                <option value="">Select data source</option>
                {dataSources.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedQuery.trigger}
                onChange={(e) =>
                  updateQuery(selectedQuery.id, {
                    trigger: e.target.value as 'manual' | 'on_load' | 'on_change',
                  })
                }
                className="text-sm border border-retool-border rounded px-2 py-1"
              >
                <option value="manual">Manual</option>
                <option value="on_load">On Load</option>
                <option value="on_change">On Change</option>
              </select>

              <button
                onClick={handleRunQuery}
                disabled={isLoading || !selectedQuery.dataSourceId}
                className="px-3 py-1 text-sm bg-retool-primary text-white rounded hover:bg-retool-hover disabled:opacity-50"
              >
                {isLoading ? 'Running...' : 'Run'}
              </button>
            </div>

            {/* SQL editor and results */}
            <div className="flex-1 flex">
              {/* SQL editor */}
              <div className="flex-1 border-r border-retool-border">
                <textarea
                  value={selectedQuery.queryText}
                  onChange={(e) => updateQuery(selectedQuery.id, { queryText: e.target.value })}
                  className="w-full h-full p-3 query-editor resize-none focus:outline-none"
                  placeholder="SELECT * FROM table_name"
                  spellCheck={false}
                />
              </div>

              {/* Results */}
              <div className="flex-1 overflow-auto">
                {currentResult ? (
                  currentResult.error ? (
                    <div className="p-3 text-sm text-red-600 bg-red-50">
                      Error: {currentResult.error}
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-retool-border sticky top-0">
                            {currentResult.fields.map((field) => (
                              <th
                                key={field.name}
                                className="px-3 py-1.5 text-left font-medium text-retool-secondary"
                              >
                                {field.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentResult.rows.map((row, i) => (
                            <tr key={i} className="border-b border-retool-border hover:bg-gray-50">
                              {currentResult.fields.map((field) => (
                                <td key={field.name} className="px-3 py-1 text-retool-text">
                                  {formatCellValue(row[field.name])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-3 py-1 text-xs text-retool-secondary bg-gray-50 border-t border-retool-border">
                        {currentResult.rowCount} row{currentResult.rowCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-retool-secondary">
                    Run the query to see results
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-retool-secondary">
            Select a query or create a new one
          </div>
        )}
      </div>

      {showDataSourceForm && <DataSourceForm onClose={() => setShowDataSourceForm(false)} />}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
