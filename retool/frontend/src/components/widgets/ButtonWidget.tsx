import type { AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { useEditorStore } from '../../stores/editorStore';

interface ButtonWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

export function ButtonWidget({ component, isEditor }: ButtonWidgetProps) {
  const executeQuery = useDataStore((s) => s.executeQuery);
  const app = useEditorStore((s) => s.app);
  const dataSources = useDataStore((s) => s.dataSources);

  const label = (component.props.label as string) || 'Button';
  const variant = (component.props.variant as string) || 'primary';
  const disabled = component.props.disabled as boolean;
  const onClick = component.props.onClick as string;

  const handleClick = async () => {
    if (isEditor) return;
    if (!onClick || !app) return;

    // Find the query to trigger
    const query = app.queries.find((q) => q.name === onClick || q.id === onClick);
    if (query && query.dataSourceId) {
      const ds = dataSources.find((d) => d.id === query.dataSourceId);
      if (ds) {
        await executeQuery(query.name, query.dataSourceId, query.queryText);
      }
    }
  };

  const variantClasses: Record<string, string> = {
    primary: 'bg-retool-primary text-white hover:bg-retool-hover',
    secondary: 'bg-gray-100 text-retool-text hover:bg-gray-200 border border-retool-border',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-retool-primary hover:bg-retool-primary/10',
  };

  return (
    <div className="flex items-center justify-center h-full p-2">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          variantClasses[variant] || variantClasses.primary
        } ${isEditor ? 'cursor-default' : ''}`}
      >
        {label}
      </button>
    </div>
  );
}
