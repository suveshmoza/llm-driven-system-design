import { getBindingSegments } from '../../utils/bindings';

interface BindingInputProps {
  value: string;
  onChange: (value: string) => void;
  onBindingChange?: (binding: string) => void;
  binding?: string;
}

/** Renders a text input with syntax highlighting for {{ binding }} expressions. */
export function BindingInput({ value, onChange, onBindingChange, binding }: BindingInputProps) {
  const segments = getBindingSegments(value);
  const hasBinding = segments.some((s) => s.isBinding);

  return (
    <div className="relative">
      {/* Visual display with highlighting */}
      {hasBinding && (
        <div className="absolute inset-0 px-2 py-1 text-sm pointer-events-none overflow-hidden whitespace-nowrap z-0">
          {segments.map((seg, i) =>
            seg.isBinding ? (
              <span key={i} className="text-retool-primary font-semibold bg-retool-primary/10 rounded px-0.5">
                {seg.text}
              </span>
            ) : (
              <span key={i} className="text-transparent">{seg.text}</span>
            ),
          )}
        </div>
      )}

      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Extract binding if it matches {{ ... }} pattern
          const match = e.target.value.match(/^\{\{\s*(.*?)\s*\}\}$/);
          if (match && onBindingChange) {
            onBindingChange(match[1]);
          }
        }}
        className={`w-full px-2 py-1 text-sm border border-retool-border rounded focus:outline-none focus:ring-1 focus:ring-retool-primary ${
          hasBinding ? 'text-retool-primary font-medium bg-retool-primary/5' : ''
        }`}
        placeholder="Value or {{ binding }}"
      />

      {/* Binding indicator */}
      {binding && (
        <div className="mt-1 text-xs text-retool-primary bg-retool-primary/5 px-2 py-0.5 rounded inline-block">
          Bound to: {binding}
        </div>
      )}
    </div>
  );
}
