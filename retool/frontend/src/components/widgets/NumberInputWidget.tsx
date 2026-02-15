import type { AppComponent } from '../../types';
import { useDataStore } from '../../stores/dataStore';

interface NumberInputWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

/** Renders a number input widget with min/max constraints. */
export function NumberInputWidget({ component, isEditor }: NumberInputWidgetProps) {
  const setComponentValue = useDataStore((s) => s.setComponentValue);
  const componentValues = useDataStore((s) => s.componentValues);

  const label = (component.props.label as string) || '';
  const min = typeof component.props.min === 'number' ? component.props.min : 0;
  const max = typeof component.props.max === 'number' ? component.props.max : 100;
  const step = typeof component.props.step === 'number' ? component.props.step : 1;
  const defaultValue = typeof component.props.defaultValue === 'number' ? component.props.defaultValue : 0;

  const currentValue =
    typeof componentValues[component.id] === 'number'
      ? (componentValues[component.id] as number)
      : defaultValue;

  const handleChange = (value: number) => {
    if (isEditor) return;
    setComponentValue(component.id, value);
  };

  return (
    <div className="flex flex-col justify-center h-full px-3 py-2">
      {label && (
        <label className="text-xs font-medium text-retool-secondary mb-1">{label}</label>
      )}
      <input
        type="number"
        value={currentValue}
        onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        readOnly={isEditor}
        className="w-full px-2 py-1.5 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
      />
    </div>
  );
}
