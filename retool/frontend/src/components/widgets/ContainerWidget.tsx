import type { AppComponent } from '../../types';

interface ContainerWidgetProps {
  component: AppComponent;
  isEditor?: boolean;
}

/** Renders a container widget that groups other widgets visually. */
export function ContainerWidget({ component }: ContainerWidgetProps) {
  const bgColor = (component.props.backgroundColor as string) || '#FFFFFF';
  const padding = typeof component.props.padding === 'number' ? component.props.padding : 16;
  const borderRadius = typeof component.props.borderRadius === 'number' ? component.props.borderRadius : 8;

  return (
    <div
      className="h-full border border-dashed border-retool-border flex items-center justify-center"
      style={{
        backgroundColor: bgColor,
        padding,
        borderRadius,
      }}
    >
      <span className="text-xs text-retool-secondary">Container</span>
    </div>
  );
}
