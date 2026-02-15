import { useEditorStore } from '../../stores/editorStore';
import { BindingInput } from './BindingInput';

export function PropertyInspector() {
  const app = useEditorStore((s) => s.app);
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
  const componentDefinitions = useEditorStore((s) => s.componentDefinitions);
  const updateComponent = useEditorStore((s) => s.updateComponent);

  if (!app || !selectedComponentId) {
    return (
      <div className="p-4 text-center text-retool-secondary text-sm">
        <p className="mt-8">Select a component to edit its properties</p>
      </div>
    );
  }

  const component = app.components.find((c) => c.id === selectedComponentId);
  if (!component) return null;

  const definition = componentDefinitions.find((d) => d.type === component.type);
  const propSchema = definition?.propSchema || [];

  const handlePropChange = (propName: string, value: unknown) => {
    updateComponent(component.id, {
      props: { ...component.props, [propName]: value },
    });
  };

  const handleBindingChange = (propName: string, binding: string) => {
    updateComponent(component.id, {
      bindings: { ...component.bindings, [propName]: binding },
      props: { ...component.props, [propName]: `{{ ${binding} }}` },
    });
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-retool-secondary uppercase tracking-wider mb-1">
          Properties
        </h3>
        <div className="text-sm font-medium text-retool-text">{component.id}</div>
        <div className="text-xs text-retool-secondary">{component.type}</div>
      </div>

      {/* Position controls */}
      <div className="mb-4 pb-4 border-b border-retool-border">
        <div className="text-xs font-medium text-retool-secondary mb-2">Position & Size</div>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="text-xs text-retool-secondary">X</label>
            <input
              type="number"
              value={component.position.x}
              onChange={(e) =>
                updateComponent(component.id, {
                  position: { ...component.position, x: parseInt(e.target.value) || 0 },
                })
              }
              className="w-full px-2 py-1 text-xs border border-retool-border rounded"
              min={0}
              max={11}
            />
          </div>
          <div>
            <label className="text-xs text-retool-secondary">Y</label>
            <input
              type="number"
              value={component.position.y}
              onChange={(e) =>
                updateComponent(component.id, {
                  position: { ...component.position, y: parseInt(e.target.value) || 0 },
                })
              }
              className="w-full px-2 py-1 text-xs border border-retool-border rounded"
              min={0}
            />
          </div>
          <div>
            <label className="text-xs text-retool-secondary">W</label>
            <input
              type="number"
              value={component.position.w}
              onChange={(e) =>
                updateComponent(component.id, {
                  position: { ...component.position, w: parseInt(e.target.value) || 1 },
                })
              }
              className="w-full px-2 py-1 text-xs border border-retool-border rounded"
              min={1}
              max={12}
            />
          </div>
          <div>
            <label className="text-xs text-retool-secondary">H</label>
            <input
              type="number"
              value={component.position.h}
              onChange={(e) =>
                updateComponent(component.id, {
                  position: { ...component.position, h: parseInt(e.target.value) || 1 },
                })
              }
              className="w-full px-2 py-1 text-xs border border-retool-border rounded"
              min={1}
            />
          </div>
        </div>
      </div>

      {/* Component props */}
      <div className="space-y-3">
        {propSchema.map((schema) => {
          const value = component.props[schema.name];
          const binding = component.bindings[schema.name];

          if (schema.bindable) {
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <BindingInput
                  value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
                  onChange={(v) => handlePropChange(schema.name, v)}
                  onBindingChange={(b) => handleBindingChange(schema.name, b)}
                  binding={binding}
                />
              </div>
            );
          }

          if (schema.type === 'boolean') {
            return (
              <div key={schema.name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => handlePropChange(schema.name, e.target.checked)}
                  className="rounded border-retool-border"
                />
                <label className="text-xs font-medium text-retool-secondary">
                  {schema.label}
                </label>
              </div>
            );
          }

          if (schema.type === 'number') {
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <input
                  type="number"
                  value={typeof value === 'number' ? value : 0}
                  onChange={(e) => handlePropChange(schema.name, parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
                />
              </div>
            );
          }

          if (schema.type === 'json') {
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <textarea
                  value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                  onChange={(e) => {
                    try {
                      handlePropChange(schema.name, JSON.parse(e.target.value));
                    } catch {
                      handlePropChange(schema.name, e.target.value);
                    }
                  }}
                  className="w-full px-2 py-1 text-xs border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary font-mono"
                  rows={4}
                />
              </div>
            );
          }

          if (schema.type === 'color') {
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={typeof value === 'string' ? value : '#000000'}
                    onChange={(e) => handlePropChange(schema.name, e.target.value)}
                    className="w-8 h-8 rounded border border-retool-border cursor-pointer"
                  />
                  <input
                    type="text"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => handlePropChange(schema.name, e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
                  />
                </div>
              </div>
            );
          }

          if (schema.type === 'select') {
            const options = getSelectOptions(schema.name, component.type);
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <select
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => handlePropChange(schema.name, e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
                >
                  {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          if (schema.type === 'action') {
            return (
              <div key={schema.name}>
                <label className="block text-xs font-medium text-retool-secondary mb-1">
                  {schema.label}
                </label>
                <input
                  type="text"
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => handlePropChange(schema.name, e.target.value)}
                  placeholder="Query name to trigger"
                  className="w-full px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
                />
              </div>
            );
          }

          // Default: string input
          return (
            <div key={schema.name}>
              <label className="block text-xs font-medium text-retool-secondary mb-1">
                {schema.label}
              </label>
              <input
                type="text"
                value={typeof value === 'string' ? value : String(value ?? '')}
                onChange={(e) => handlePropChange(schema.name, e.target.value)}
                className="w-full px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getSelectOptions(
  propName: string,
  componentType: string,
): { value: string; label: string }[] {
  if (propName === 'variant') {
    return [
      { value: 'primary', label: 'Primary' },
      { value: 'secondary', label: 'Secondary' },
      { value: 'danger', label: 'Danger' },
      { value: 'ghost', label: 'Ghost' },
    ];
  }
  if (propName === 'fontWeight') {
    return [
      { value: 'normal', label: 'Normal' },
      { value: 'medium', label: 'Medium' },
      { value: 'bold', label: 'Bold' },
    ];
  }
  if (propName === 'type' && componentType === 'chart') {
    return [
      { value: 'bar', label: 'Bar Chart' },
      { value: 'line', label: 'Line Chart' },
    ];
  }
  return [];
}
