import { useRef, useCallback } from 'react';

interface PageEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
}

/** ContentEditable rich text editor with formatting toolbar and macro insertion. */
export default function PageEditor({ initialContent, onChange }: PageEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  }, [handleInput]);

  const insertMacro = useCallback((type: 'info' | 'warning' | 'note') => {
    const colors: Record<string, { bg: string; border: string; label: string; icon: string }> = {
      info: { bg: '#DEEBFF', border: '#0052CC', label: 'Info', icon: 'i' },
      warning: { bg: '#FFFAE6', border: '#FF8B00', label: 'Warning', icon: '!' },
      note: { bg: '#EAE6FF', border: '#6554C0', label: 'Note', icon: '*' },
    };

    const c = colors[type];
    const macroHtml = `<div class="macro-${type}" style="background:${c.bg};border-left:4px solid ${c.border};padding:12px 16px;border-radius:4px;margin:8px 0;" contenteditable="true">
      <strong style="color:${c.border};">${c.label}</strong>
      <div style="margin-top:4px;">Type your ${type} message here...</div>
    </div><p><br></p>`;

    document.execCommand('insertHTML', false, macroHtml);
    handleInput();
  }, [handleInput]);

  return (
    <div className="border border-confluence-border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="editor-toolbar flex items-center gap-1 p-2 bg-confluence-sidebar border-b border-confluence-border flex-wrap">
        <button
          onClick={() => execCommand('bold')}
          className="px-2 py-1 rounded text-sm font-bold text-confluence-text hover:bg-white"
          title="Bold"
        >
          B
        </button>
        <button
          onClick={() => execCommand('italic')}
          className="px-2 py-1 rounded text-sm italic text-confluence-text hover:bg-white"
          title="Italic"
        >
          I
        </button>

        <div className="w-px h-5 bg-confluence-border mx-1" />

        <button
          onClick={() => execCommand('formatBlock', 'h1')}
          className="px-2 py-1 rounded text-sm font-bold text-confluence-text hover:bg-white"
          title="Heading 1"
        >
          H1
        </button>
        <button
          onClick={() => execCommand('formatBlock', 'h2')}
          className="px-2 py-1 rounded text-sm font-bold text-confluence-text hover:bg-white"
          title="Heading 2"
        >
          H2
        </button>
        <button
          onClick={() => execCommand('formatBlock', 'h3')}
          className="px-2 py-1 rounded text-sm font-bold text-confluence-text hover:bg-white"
          title="Heading 3"
        >
          H3
        </button>

        <div className="w-px h-5 bg-confluence-border mx-1" />

        <button
          onClick={() => execCommand('insertUnorderedList')}
          className="px-2 py-1 rounded text-sm text-confluence-text hover:bg-white"
          title="Bullet List"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          onClick={() => execCommand('insertOrderedList')}
          className="px-2 py-1 rounded text-sm text-confluence-text hover:bg-white"
          title="Numbered List"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>

        <div className="w-px h-5 bg-confluence-border mx-1" />

        <button
          onClick={() => execCommand('formatBlock', 'pre')}
          className="px-2 py-1 rounded text-sm font-mono text-confluence-text hover:bg-white"
          title="Code Block"
        >
          {'</>'}
        </button>
        <button
          onClick={() => {
            const url = prompt('Enter URL:');
            if (url) execCommand('createLink', url);
          }}
          className="px-2 py-1 rounded text-sm text-confluence-text hover:bg-white"
          title="Insert Link"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>

        <div className="w-px h-5 bg-confluence-border mx-1" />

        {/* Macro buttons */}
        <button
          onClick={() => insertMacro('info')}
          className="px-2 py-1 rounded text-xs font-medium bg-confluence-info text-confluence-primary hover:brightness-95"
          title="Info Panel"
        >
          Info
        </button>
        <button
          onClick={() => insertMacro('warning')}
          className="px-2 py-1 rounded text-xs font-medium bg-confluence-warning text-yellow-800 hover:brightness-95"
          title="Warning Panel"
        >
          Warn
        </button>
        <button
          onClick={() => insertMacro('note')}
          className="px-2 py-1 rounded text-xs font-medium bg-confluence-note text-purple-800 hover:brightness-95"
          title="Note Panel"
        >
          Note
        </button>
      </div>

      {/* Content editable area */}
      <div
        ref={editorRef}
        contentEditable
        className="wiki-content min-h-[400px] p-6 outline-none bg-white"
        onInput={handleInput}
        dangerouslySetInnerHTML={{ __html: initialContent }}
        suppressContentEditableWarning
      />
    </div>
  );
}
