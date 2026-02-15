import { useEffect, useMemo } from 'react';
import type { App, AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

const COL_WIDTH = 80;
const ROW_HEIGHT = 40;

interface PreviewRendererProps {
  app: App;
}

export function PreviewRenderer({ app }: PreviewRendererProps) {
  const executeQuery = useDataStore((s) => s.executeQuery);
  const dataSources = useDataStore((s) => s.dataSources);
  const loadDataSources = useDataStore((s) => s.loadDataSources);

  // Load data sources on mount
  useEffect(() => {
    loadDataSources();
  }, [loadDataSources]);

  // Run on_load queries after data sources are loaded
  useEffect(() => {
    if (dataSources.length === 0) return;

    const onLoadQueries = app.queries.filter((q) => q.trigger === 'on_load');
    onLoadQueries.forEach((query) => {
      if (query.dataSourceId) {
        executeQuery(query.name, query.dataSourceId, query.queryText);
      }
    });
  }, [app.queries, dataSources, executeQuery]);

  // Calculate canvas size
  const maxRow = useMemo(
    () =>
      app.components.reduce(
        (max, c) => Math.max(max, (c.position?.y ?? 0) + (c.position?.h ?? 2)),
        10,
      ),
    [app.components],
  );

  const canvasHeight = (maxRow + 2) * ROW_HEIGHT;

  return (
    <div
      className="relative bg-white rounded-lg border border-retool-border mx-auto"
      style={{
        width: 12 * COL_WIDTH,
        minHeight: canvasHeight,
      }}
    >
      {app.components.map((component: AppComponent) => {
        const pos = component.position || { x: 0, y: 0, w: 4, h: 2 };

        return (
          <div
            key={component.id}
            className="absolute"
            style={{
              left: pos.x * COL_WIDTH,
              top: pos.y * ROW_HEIGHT,
              width: pos.w * COL_WIDTH,
              height: pos.h * ROW_HEIGHT,
            }}
          >
            <div className="w-full h-full bg-white rounded border border-retool-border overflow-hidden">
              <WidgetRenderer component={component} isEditor={false} />
            </div>
          </div>
        );
      })}

      {app.components.length === 0 && (
        <div className="flex items-center justify-center h-64 text-retool-secondary">
          This app has no components yet.
        </div>
      )}
    </div>
  );
}
