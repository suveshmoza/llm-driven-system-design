import { useSpreadsheetStore } from '../stores/spreadsheet';

interface CollaboratorCursorsProps {
  getColumnWidth: (index: number) => number;
  getRowHeight: (index: number) => number;
}

export function CollaboratorCursors({
  getColumnWidth,
  getRowHeight,
}: CollaboratorCursorsProps) {
  const collaborators = useSpreadsheetStore((state) => state.collaborators);
  const userId = useSpreadsheetStore((state) => state.userId);

  // Calculate position for a cell
  const getCellPosition = (row: number, col: number) => {
    let top = 0;
    let left = 0;

    for (let r = 0; r < row; r++) {
      top += getRowHeight(r);
    }

    for (let c = 0; c < col; c++) {
      left += getColumnWidth(c);
    }

    return { top, left, width: getColumnWidth(col), height: getRowHeight(row) };
  };

  return (
    <>
      {Array.from(collaborators.values())
        .filter((collab) => collab.userId !== userId && collab.cursor)
        .map((collab) => {
          const { top, left, width, height } = getCellPosition(
            collab.cursor!.row,
            collab.cursor!.col
          );

          return (
            <div key={collab.userId}>
              {/* Cursor outline */}
              <div
                style={{
                  position: 'absolute',
                  top,
                  left,
                  width,
                  height,
                  border: `2px solid ${collab.color}`,
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
              {/* Name label */}
              <div
                style={{
                  position: 'absolute',
                  top: top - 20,
                  left,
                  backgroundColor: collab.color,
                  color: 'white',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '3px 3px 0 0',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 6,
                }}
              >
                {collab.name}
              </div>
            </div>
          );
        })}

      {/* Selection overlays for collaborators */}
      {Array.from(collaborators.values())
        .filter((collab) => collab.userId !== userId && collab.selection)
        .map((collab) => {
          const { selection } = collab;
          if (!selection) return null;

          const startPos = getCellPosition(
            Math.min(selection.startRow, selection.endRow),
            Math.min(selection.startCol, selection.endCol)
          );
          const endPos = getCellPosition(
            Math.max(selection.startRow, selection.endRow),
            Math.max(selection.startCol, selection.endCol)
          );

          return (
            <div
              key={`selection-${collab.userId}`}
              style={{
                position: 'absolute',
                top: startPos.top,
                left: startPos.left,
                width: endPos.left + endPos.width - startPos.left,
                height: endPos.top + endPos.height - startPos.top,
                backgroundColor: `${collab.color}20`,
                border: `1px solid ${collab.color}`,
                pointerEvents: 'none',
                zIndex: 4,
              }}
            />
          );
        })}
    </>
  );
}
