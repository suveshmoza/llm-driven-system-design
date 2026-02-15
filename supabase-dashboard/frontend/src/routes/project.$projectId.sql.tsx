import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { SQLEditor } from '../components/SQLEditor';
import { QueryResults } from '../components/QueryResults';
import { SavedQueryList } from '../components/SavedQueryList';

function SQLPage() {
  const { projectId } = Route.useParams();
  const {
    queryResult,
    queryError,
    queryLoading,
    savedQueries,
    executeQuery,
    loadSavedQueries,
    saveQuery,
    deleteSavedQuery,
    clearQueryResult,
  } = useProjectStore();
  const [sql, setSql] = useState('SELECT * FROM products LIMIT 10;');

  useEffect(() => {
    loadSavedQueries(projectId);
    return () => clearQueryResult();
  }, [projectId, loadSavedQueries, clearQueryResult]);

  const handleRun = () => {
    if (sql.trim()) {
      executeQuery(projectId, sql);
    }
  };

  const handleSave = () => {
    const name = prompt('Query name:');
    if (name && sql.trim()) {
      saveQuery(projectId, name, sql);
    }
  };

  return (
    <div className="flex h-full">
      {/* Saved queries sidebar */}
      <div className="w-56 border-r border-supabase-border bg-supabase-dark-surface overflow-y-auto">
        <div className="p-4 border-b border-supabase-border">
          <h3 className="text-sm font-medium text-supabase-text">Saved Queries</h3>
        </div>
        <SavedQueryList
          queries={savedQueries}
          onSelect={(q) => setSql(q.queryText)}
          onDelete={(id) => deleteSavedQuery(projectId, id)}
        />
      </div>

      {/* Editor + Results */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor */}
        <div className="border-b border-supabase-border">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-supabase-text">SQL Editor</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="text-supabase-secondary hover:text-supabase-text text-sm px-3 py-1 border border-supabase-border rounded"
                >
                  Save
                </button>
                <button
                  onClick={handleRun}
                  disabled={queryLoading || !sql.trim()}
                  className="bg-supabase-primary hover:bg-supabase-hover text-black px-4 py-1 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {queryLoading ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
            <SQLEditor value={sql} onChange={setSql} onRun={handleRun} />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto">
          {queryError && (
            <div className="m-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded text-sm">
              {queryError}
            </div>
          )}
          {queryResult && <QueryResults result={queryResult} />}
          {!queryResult && !queryError && !queryLoading && (
            <div className="flex items-center justify-center h-full text-supabase-secondary text-sm">
              Run a query to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/project/$projectId/sql')({
  component: SQLPage,
});
