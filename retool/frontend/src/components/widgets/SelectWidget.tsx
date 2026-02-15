import type { AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';

interface SelectWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

export function SelectWidget({ component, isEditor }: SelectWidgetProps) {
  const setComponentValue = useDataStore((s) => s.setComponentValue);
  const componentValues = useDataStore((s) => s.componentValues);

  const label = (component.props.label as string) || '';
  const placeholder = (component.props.placeholder as string) || 'Choose an option...';
  const options = Array.isArray(component.props.options)
    ? (component.props.options as { label: string; value: string }[])
    : [];

  const currentValue =
    (componentValues[component.id] as string) ?? (component.props.value as string) ?? '';

  const handleChange = (value: string) => {
    if (isEditor) return;
    setComponentValue(component.id, value);
  };

  return (
    <div className="flex flex-col justify-center h-full px-3 py-2">
      {label && (
        <label className="text-xs font-medium text-retool-secondary mb-1">{label}</label>
      )}
      <select
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isEditor}
        className="w-full px-2 py-1.5 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
      >
        <option value="">{placeholder}</option>
        {options.map((opt, i) => (
          <option key={i} value={typeof opt === 'object' ? opt.value : String(opt)}>
            {typeof opt === 'object' ? opt.label : String(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}
