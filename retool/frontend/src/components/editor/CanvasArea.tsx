import { useDroppable } from '@dnd-kit/core';
import { useEditorStore } from '../../stores/editorStore';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

const GRID_COLS = 12;
const COL_WIDTH = 80;
const ROW_HEIGHT = 40;

export function CanvasArea() {
  const app = useEditorStore((s) => s.app);
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const moveComponent = useEditorStore((s) => s.moveComponent);
  const resizeComponent = useEditorStore((s) => s.resizeComponent);

  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' });

  if (!app) return null;

  // Calculate canvas height based on component positions
  const maxRow = app.components.reduce(
    (max, c) => Math.max(max, c.position.y + c.position.h),
    15,
  );

  const canvasHeight = Math.max(maxRow + 5, 20) * ROW_HEIGHT;

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      selectComponent(null);
    }
  };

  return (
    <div
      ref={setNodeRef}
      id="canvas-area"
      className={`relative canvas-grid min-h-full ${isOver ? 'bg-retool-primary/5' : 'bg-retool-bg'}`}
      style={{
        width: GRID_COLS * COL_WIDTH,
        minHeight: canvasHeight,
        margin: '0 auto',
      }}
      onClick={handleCanvasClick}
    >
      {app.components.map((component) => {
        const isSelected = selectedComponentId === component.id;

        return (
          <div
            key={component.id}
            className={`absolute group transition-shadow ${
              isSelected
                ? 'ring-2 ring-retool-primary shadow-md'
                : 'hover:ring-1 hover:ring-retool-primary/50'
            }`}
            style={{
              left: component.position.x * COL_WIDTH,
              top: component.position.y * ROW_HEIGHT,
              width: component.position.w * COL_WIDTH,
              height: component.position.h * ROW_HEIGHT,
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectComponent(component.id);
            }}
          >
            {/* Component label */}
            <div className="absolute -top-5 left-0 text-xs text-retool-secondary bg-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10">
              {component.id}
            </div>

            {/* Component content */}
            <div className="w-full h-full bg-white rounded-lg border border-retool-border overflow-hidden">
              <WidgetRenderer component={component} isEditor={true} />
            </div>

            {/* Delete button */}
            {isSelected && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeComponent(component.id);
                }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 z-20"
              >
                x
              </button>
            )}

            {/* Move handles - arrow buttons */}
            {isSelected && (
              <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex gap-1 z-20">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveComponent(component.id, {
                      x: Math.max(0, component.position.x - 1),
                      y: component.position.y,
                    });
                  }}
                  className="w-5 h-5 bg-gray-600 text-white rounded text-xs flex items-center justify-center hover:bg-gray-700"
                  title="Move left"
                >
                  &larr;
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveComponent(component.id, {
                      x: component.position.x,
                      y: Math.max(0, component.position.y - 1),
                    });
                  }}
                  className="w-5 h-5 bg-gray-600 text-white rounded text-xs flex items-center justify-center hover:bg-gray-700"
                  title="Move up"
                >
                  &uarr;
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveComponent(component.id, {
                      x: component.position.x,
                      y: component.position.y + 1,
                    });
                  }}
                  className="w-5 h-5 bg-gray-600 text-white rounded text-xs flex items-center justify-center hover:bg-gray-700"
                  title="Move down"
                >
                  &darr;
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveComponent(component.id, {
                      x: Math.min(GRID_COLS - component.position.w, component.position.x + 1),
                      y: component.position.y,
                    });
                  }}
                  className="w-5 h-5 bg-gray-600 text-white rounded text-xs flex items-center justify-center hover:bg-gray-700"
                  title="Move right"
                >
                  &rarr;
                </button>
                <span className="text-gray-400 mx-1">|</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resizeComponent(component.id, {
                      w: Math.max(1, component.position.w - 1),
                      h: component.position.h,
                    });
                  }}
                  className="w-5 h-5 bg-blue-600 text-white rounded text-xs flex items-center justify-center hover:bg-blue-700"
                  title="Shrink width"
                >
                  -W
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resizeComponent(component.id, {
                      w: Math.min(GRID_COLS - component.position.x, component.position.w + 1),
                      h: component.position.h,
                    });
                  }}
                  className="w-5 h-5 bg-blue-600 text-white rounded text-xs flex items-center justify-center hover:bg-blue-700"
                  title="Grow width"
                >
                  +W
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resizeComponent(component.id, {
                      w: component.position.w,
                      h: Math.max(1, component.position.h - 1),
                    });
                  }}
                  className="w-5 h-5 bg-blue-600 text-white rounded text-xs flex items-center justify-center hover:bg-blue-700"
                  title="Shrink height"
                >
                  -H
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resizeComponent(component.id, {
                      w: component.position.w,
                      h: component.position.h + 1,
                    });
                  }}
                  className="w-5 h-5 bg-blue-600 text-white rounded text-xs flex items-center justify-center hover:bg-blue-700"
                  title="Grow height"
                >
                  +H
                </button>
              </div>
            )}
          </div>
        );
      })}

      {app.components.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-retool-secondary">
            <div className="text-lg mb-2">Drag components here</div>
            <div className="text-sm">Pick a component from the left panel and drop it on the canvas</div>
          </div>
        </div>
      )}
    </div>
  );
}
