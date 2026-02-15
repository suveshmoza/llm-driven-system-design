import { useDraggable } from '@dnd-kit/core';
import { useEditorStore } from '../../stores/editorStore';
import type { ComponentDefinition } from '../../types';

const COMPONENT_ICONS: Record<string, string> = {
  table: 'T',
  'text-input': 'Aa',
  button: 'B',
  text: 'Tx',
  'number-input': '#',
  select: 'S',
  chart: 'C',
  form: 'F',
  container: 'Co',
};

function DraggableComponent({ definition }: { definition: ComponentDefinition }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: definition.type,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-grab hover:bg-retool-bg transition-colors ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div className="w-8 h-8 bg-retool-primary/10 text-retool-primary rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">
        {COMPONENT_ICONS[definition.icon] || '?'}
      </div>
      <div>
        <div className="text-sm font-medium text-retool-text">{definition.label}</div>
        <div className="text-xs text-retool-secondary">{definition.category}</div>
      </div>
    </div>
  );
}

export function ComponentPalette() {
  const componentDefinitions = useEditorStore((s) => s.componentDefinitions);

  // Group by category
  const grouped = componentDefinitions.reduce<Record<string, ComponentDefinition[]>>(
    (acc, def) => {
      const cat = def.category || 'Other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(def);
      return acc;
    },
    {},
  );

  return (
    <div className="p-3">
      <h3 className="text-xs font-semibold text-retool-secondary uppercase tracking-wider mb-3 px-1">
        Components
      </h3>

      {Object.entries(grouped).map(([category, components]) => (
        <div key={category} className="mb-4">
          <div className="text-xs font-medium text-retool-secondary px-1 mb-1">{category}</div>
          <div className="space-y-0.5">
            {components.map((def) => (
              <DraggableComponent key={def.type} definition={def} />
            ))}
          </div>
        </div>
      ))}

      {componentDefinitions.length === 0 && (
        <div className="text-sm text-retool-secondary text-center py-4">
          Loading components...
        </div>
      )}
    </div>
  );
}
