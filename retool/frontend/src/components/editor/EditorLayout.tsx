import { DndContext, DragOverlay, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { ComponentPalette } from './ComponentPalette';
import { CanvasArea } from './CanvasArea';
import { PropertyInspector } from './PropertyInspector';
import { QueryPanel } from './QueryPanel';
import type { ComponentDefinition } from '../../types';

export function EditorLayout() {
  const addComponent = useEditorStore((s) => s.addComponent);
  const componentDefinitions = useEditorStore((s) => s.componentDefinitions);
  const queryPanelOpen = useEditorStore((s) => s.queryPanelOpen);
  const [activeDragItem, setActiveDragItem] = useState<ComponentDefinition | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const definition = componentDefinitions.find((c) => c.type === active.id);
    if (definition) {
      setActiveDragItem(definition);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);

    if (over?.id === 'canvas') {
      const definition = componentDefinitions.find((c) => c.type === active.id);
      if (definition) {
        // Calculate approximate position from pointer
        const canvasRect = document.getElementById('canvas-area')?.getBoundingClientRect();
        if (canvasRect && event.activatorEvent instanceof PointerEvent) {
          const relativeX = event.activatorEvent.clientX - canvasRect.left + (event.delta?.x || 0);
          const relativeY = event.activatorEvent.clientY - canvasRect.top + (event.delta?.y || 0);
          const gridCol = Math.max(0, Math.min(11, Math.floor(relativeX / 80)));
          const gridRow = Math.max(0, Math.floor(relativeY / 40));

          addComponent(definition, { x: gridCol, y: gridRow });
        } else {
          addComponent(definition);
        }
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-48px)]">
        {/* Left: Component Palette */}
        <div className="w-[250px] bg-white border-r border-retool-border overflow-y-auto flex-shrink-0">
          <ComponentPalette />
        </div>

        {/* Center: Canvas + Query Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <CanvasArea />
          </div>

          {queryPanelOpen && (
            <div className="h-[250px] border-t border-retool-border flex-shrink-0">
              <QueryPanel />
            </div>
          )}
        </div>

        {/* Right: Property Inspector */}
        <div className="w-[300px] bg-white border-l border-retool-border overflow-y-auto flex-shrink-0">
          <PropertyInspector />
        </div>
      </div>

      <DragOverlay>
        {activeDragItem && (
          <div className="drag-overlay bg-white border-2 border-retool-primary rounded-lg px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2">
              <ComponentIcon type={activeDragItem.icon} />
              <span className="text-sm font-medium">{activeDragItem.label}</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function ComponentIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
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
  return (
    <div className="w-6 h-6 bg-retool-primary/10 text-retool-primary rounded flex items-center justify-center text-xs font-bold">
      {icons[type] || '?'}
    </div>
  );
}
