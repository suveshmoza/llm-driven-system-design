interface MacroNode {
  type: string;
  attrs?: Record<string, string>;
  content?: string;
}

interface MacroRendererProps {
  contentJson: {
    macros?: MacroNode[];
  };
}

/** Renders wiki macros (info, warning, note, code, toc) as styled React components. */
export default function MacroRenderer({ contentJson }: MacroRendererProps) {
  if (!contentJson?.macros || contentJson.macros.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 space-y-2">
      {contentJson.macros.map((macro, index) => {
        switch (macro.type) {
          case 'info':
            return (
              <div
                key={index}
                className="bg-confluence-info border-l-4 border-[#0052CC] p-3 rounded"
              >
                <div className="font-semibold text-[#0052CC] text-sm mb-1">Info</div>
                <div className="text-sm text-confluence-text">{macro.content}</div>
              </div>
            );

          case 'warning':
            return (
              <div
                key={index}
                className="bg-confluence-warning border-l-4 border-[#FF8B00] p-3 rounded"
              >
                <div className="font-semibold text-[#FF8B00] text-sm mb-1">Warning</div>
                <div className="text-sm text-confluence-text">{macro.content}</div>
              </div>
            );

          case 'note':
            return (
              <div
                key={index}
                className="bg-confluence-note border-l-4 border-[#6554C0] p-3 rounded"
              >
                <div className="font-semibold text-[#6554C0] text-sm mb-1">Note</div>
                <div className="text-sm text-confluence-text">{macro.content}</div>
              </div>
            );

          case 'code':
            return (
              <pre
                key={index}
                className="bg-confluence-sidebar border border-confluence-border rounded p-3 text-sm font-mono overflow-x-auto"
              >
                <code>{macro.content}</code>
              </pre>
            );

          case 'toc':
            return (
              <div
                key={index}
                className="bg-confluence-sidebar border border-confluence-border rounded p-3"
              >
                <div className="font-semibold text-confluence-text text-sm mb-1">
                  Table of Contents
                </div>
                <div className="text-xs text-confluence-text-muted">
                  Generated from page headings
                </div>
              </div>
            );

          default:
            return (
              <div
                key={index}
                className="bg-red-50 border-l-4 border-confluence-danger p-3 rounded"
              >
                <div className="font-semibold text-confluence-danger text-sm">
                  Unknown macro: {macro.type}
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}
