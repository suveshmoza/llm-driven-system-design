import type { AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';

interface TextInputWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

export function TextInputWidget({ component, isEditor }: TextInputWidgetProps) {
  const setComponentValue = useDataStore((s) => s.setComponentValue);
  const componentValues = useDataStore((s) => s.componentValues);

  const label = (component.props.label as string) || '';
  const placeholder = (component.props.placeholder as string) || '';
  const defaultValue = (component.props.defaultValue as string) || '';

  const currentValue =
    (componentValues[component.id] as string) ?? defaultValue;

  const handleChange = (value: string) => {
    if (isEditor) return;
    setComponentValue(component.id, value);
  };

  return (
    <div className="flex flex-col justify-center h-full px-3 py-2">
      {label && (
        <label className="text-xs font-medium text-retool-secondary mb-1">{label}</label>
      )}
      <input
        type="text"
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        readOnly={isEditor}
        className="w-full px-2 py-1.5 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
      />
    </div>
  );
}
