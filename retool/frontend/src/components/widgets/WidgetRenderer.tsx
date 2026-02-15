import type { AppComponent } from '../../types';
import { TableWidget } from './TableWidget';
import { ButtonWidget } from './ButtonWidget';
import { TextInputWidget } from './TextInputWidget';
import { TextWidget } from './TextWidget';
import { NumberInputWidget } from './NumberInputWidget';
import { SelectWidget } from './SelectWidget';
import { ChartWidget } from './ChartWidget';
import { FormWidget } from './FormWidget';
import { ContainerWidget } from './ContainerWidget';

interface WidgetRendererProps {
  component: AppComponent;
  isEditor?: boolean;
}

const WIDGET_MAP: Record<
  string,
  React.ComponentType<{ component: AppComponent; isEditor?: boolean }>
> = {
  table: TableWidget,
  button: ButtonWidget,
  textInput: TextInputWidget,
  text: TextWidget,
  numberInput: NumberInputWidget,
  select: SelectWidget,
  chart: ChartWidget,
  form: FormWidget,
  container: ContainerWidget,
};

/** Dynamically renders a widget component based on its type from the component registry. */
export function WidgetRenderer({ component, isEditor }: WidgetRendererProps) {
  const Widget = WIDGET_MAP[component.type];

  if (!Widget) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-retool-secondary bg-gray-50 p-2">
        Unknown: {component.type}
      </div>
    );
  }

  return <Widget component={component} isEditor={isEditor} />;
}
