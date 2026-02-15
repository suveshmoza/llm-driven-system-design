import { useState } from 'react';
import type { Template } from '../types';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: Template) => void;
  onClose: () => void;
}

/** Modal dialog for selecting a page template or starting with a blank page. */
export default function TemplatePicker({ templates, onSelect, onClose }: TemplatePickerProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleUse = () => {
    const template = templates.find((t) => t.id === selected);
    if (template) {
      onSelect(template);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-confluence-border">
          <h2 className="text-lg font-semibold text-confluence-text">Choose a Template</h2>
          <button
            onClick={onClose}
            className="text-confluence-text-muted hover:text-confluence-text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Blank page option */}
          <button
            onClick={() => setSelected(null)}
            className={`w-full text-left p-3 rounded border ${
              selected === null
                ? 'border-confluence-primary bg-confluence-info'
                : 'border-confluence-border hover:bg-confluence-sidebar'
            } transition-colors`}
          >
            <div className="font-medium text-confluence-text">Blank Page</div>
            <div className="text-xs text-confluence-text-subtle">Start with an empty page</div>
          </button>

          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelected(template.id)}
              className={`w-full text-left p-3 rounded border ${
                selected === template.id
                  ? 'border-confluence-primary bg-confluence-info'
                  : 'border-confluence-border hover:bg-confluence-sidebar'
              } transition-colors`}
            >
              <div className="font-medium text-confluence-text">{template.name}</div>
              {template.description && (
                <div className="text-xs text-confluence-text-subtle mt-0.5">
                  {template.description}
                </div>
              )}
              {template.is_global && (
                <span className="text-[10px] px-1.5 py-0.5 bg-confluence-sidebar text-confluence-text-muted rounded mt-1 inline-block">
                  Global
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-confluence-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-confluence-text-subtle border border-confluence-border rounded hover:bg-confluence-sidebar"
          >
            Cancel
          </button>
          <button
            onClick={handleUse}
            className="px-4 py-2 text-sm bg-confluence-primary text-white rounded hover:bg-confluence-hover"
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}
