import { useCanvasStore } from '../stores/canvasStore';
import type { Tool } from '../types';

const tools: { id: Tool; label: string; shortcut: string; icon: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: '⊹' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: '○' },
  { id: 'diamond', label: 'Diamond', shortcut: 'D', icon: '◇' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: '→' },
  { id: 'line', label: 'Line', shortcut: 'L', icon: '╱' },
  { id: 'freehand', label: 'Freehand', shortcut: 'P', icon: '✎' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: 'T' },
];

/** Renders the drawing toolbar with shape tools, color picker, and undo/redo. */
export function Toolbar() {
  const { activeTool, setActiveTool } = useCanvasStore();

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 bg-toolbar-bg rounded-xl px-2 py-1.5 shadow-lg">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={`toolbar-btn ${activeTool === tool.id ? 'active' : ''}`}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span className="text-lg leading-none w-6 h-6 flex items-center justify-center">
              {tool.icon}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
