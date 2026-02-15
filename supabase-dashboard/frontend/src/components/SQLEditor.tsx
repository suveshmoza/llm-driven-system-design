interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

/** Renders a SQL text editor with Ctrl+Enter execution and tab indentation support. */
export function SQLEditor({ value, onChange, onRun }: SQLEditorProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
    // Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newValue);
      // Reset cursor position after React re-renders
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="sql-editor w-full border border-supabase-border rounded-md px-4 py-3 resize-y focus:outline-none focus:border-supabase-primary min-h-[120px]"
        placeholder="SELECT * FROM table_name;"
        spellCheck={false}
      />
      <div className="absolute bottom-2 right-2 text-xs text-supabase-secondary">
        Ctrl+Enter to run
      </div>
    </div>
  );
}
