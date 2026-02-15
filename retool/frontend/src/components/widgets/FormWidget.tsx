import type { AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { useEditorStore } from '../../stores/editorStore';

interface FormWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

export function FormWidget({ component, isEditor }: FormWidgetProps) {
  const submitLabel = (component.props.submitLabel as string) || 'Submit';
  const onSubmit = component.props.onSubmit as string;
  const executeQuery = useDataStore((s) => s.executeQuery);
  const app = useEditorStore((s) => s.app);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditor) return;

    if (onSubmit && app) {
      const query = app.queries.find((q) => q.name === onSubmit || q.id === onSubmit);
      if (query && query.dataSourceId) {
        await executeQuery(query.name, query.dataSourceId, query.queryText);
      }
    }
  };

  return (
    <div className="flex flex-col h-full p-3">
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center text-sm text-retool-secondary">
          Form Container
        </div>
        <button
          type="submit"
          disabled={isEditor}
          className="w-full py-2 bg-retool-primary text-white rounded-lg text-sm font-medium hover:bg-retool-hover disabled:cursor-default"
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
