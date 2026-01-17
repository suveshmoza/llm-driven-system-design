import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSpreadsheetStore, getColumnLetter } from '../stores/spreadsheet';
import { Cell } from './Cell';
import { CollaboratorCursors } from './CollaboratorCursors';

const MAX_ROWS = 1000;
const MAX_COLS = 26; // A-Z for simplicity
const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_COL_WIDTH = 100;
const HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 50;

export function SpreadsheetGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const columnWidths = useSpreadsheetStore((state) => state.columnWidths);
  const rowHeights = useSpreadsheetStore((state) => state.rowHeights);
  const activeCell = useSpreadsheetStore((state) => state.activeCell);
  const editingCell = useSpreadsheetStore((state) => state.editingCell);
  const moveActiveCell = useSpreadsheetStore((state) => state.moveActiveCell);
  const startEditing = useSpreadsheetStore((state) => state.startEditing);
  const commitEdit = useSpreadsheetStore((state) => state.commitEdit);
  const setEditValue = useSpreadsheetStore((state) => state.setEditValue);

  const getColumnWidth = useCallback(
    (index: number) => columnWidths.get(index) ?? DEFAULT_COL_WIDTH,
    [columnWidths]
  );

  const getRowHeight = useCallback(
    (index: number) => rowHeights.get(index) ?? DEFAULT_ROW_HEIGHT,
    [rowHeights]
  );

  const rowVirtualizer = useVirtualizer({
    count: MAX_ROWS,
    getScrollElement: () => containerRef.current,
    estimateSize: getRowHeight,
    overscan: 10,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: MAX_COLS,
    getScrollElement: () => containerRef.current,
    estimateSize: getColumnWidth,
    overscan: 5,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveActiveCell('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveActiveCell('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveActiveCell('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveActiveCell('right');
          break;
        case 'Enter':
          e.preventDefault();
          if (editingCell) {
            commitEdit();
            moveActiveCell('down');
          } else if (activeCell) {
            startEditing(activeCell.row, activeCell.col);
          }
          break;
        case 'Tab':
          e.preventDefault();
          if (editingCell) {
            commitEdit();
          }
          moveActiveCell(e.shiftKey ? 'left' : 'right');
          break;
        default:
          // Start editing on any printable character
          if (
            activeCell &&
            !editingCell &&
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey
          ) {
            startEditing(activeCell.row, activeCell.col);
            setEditValue(e.key);
          }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeCell, editingCell, moveActiveCell, startEditing, commitEdit, setEditValue]);

  // Prevent scroll on selection
  useEffect(() => {
    const handleMouseUp = () => {
      useSpreadsheetStore.getState().stopSelecting();
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = columnVirtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className="spreadsheet-container"
      style={{
        width: '100%',
        height: 'calc(100vh - 100px)',
        overflow: 'auto',
        position: 'relative',
        backgroundColor: '#f8f9fa',
      }}
      tabIndex={0}
    >
      {/* Column Headers (frozen) */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          zIndex: 20,
          display: 'flex',
          backgroundColor: '#f1f3f4',
        }}
      >
        {/* Top-left corner */}
        <div
          style={{
            width: ROW_HEADER_WIDTH,
            height: HEADER_HEIGHT,
            backgroundColor: '#f1f3f4',
            borderRight: '1px solid #c0c0c0',
            borderBottom: '1px solid #c0c0c0',
            position: 'sticky',
            left: 0,
            zIndex: 30,
          }}
        />
        {/* Column headers */}
        <div
          style={{
            position: 'relative',
            height: HEADER_HEIGHT,
            width: columnVirtualizer.getTotalSize(),
          }}
        >
          {virtualCols.map((virtualCol) => (
            <div
              key={virtualCol.key}
              style={{
                position: 'absolute',
                left: virtualCol.start,
                width: virtualCol.size,
                height: HEADER_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f1f3f4',
                borderRight: '1px solid #c0c0c0',
                borderBottom: '1px solid #c0c0c0',
                fontSize: '12px',
                fontWeight: 500,
                color: '#5f6368',
                userSelect: 'none',
              }}
            >
              {getColumnLetter(virtualCol.index)}
            </div>
          ))}
        </div>
      </div>

      {/* Main grid area */}
      <div style={{ display: 'flex' }}>
        {/* Row Headers (frozen) */}
        <div
          style={{
            position: 'sticky',
            left: 0,
            zIndex: 10,
            backgroundColor: '#f1f3f4',
          }}
        >
          <div
            style={{
              position: 'relative',
              height: rowVirtualizer.getTotalSize(),
              width: ROW_HEADER_WIDTH,
            }}
          >
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  height: virtualRow.size,
                  width: ROW_HEADER_WIDTH,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#f1f3f4',
                  borderRight: '1px solid #c0c0c0',
                  borderBottom: '1px solid #e0e0e0',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#5f6368',
                  userSelect: 'none',
                }}
              >
                {virtualRow.index + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Cells */}
        <div
          ref={gridRef}
          style={{
            position: 'relative',
            height: rowVirtualizer.getTotalSize(),
            width: columnVirtualizer.getTotalSize(),
          }}
        >
          {virtualRows.map((virtualRow) =>
            virtualCols.map((virtualCol) => (
              <Cell
                key={`${virtualRow.index}-${virtualCol.index}`}
                rowIndex={virtualRow.index}
                colIndex={virtualCol.index}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: virtualCol.start,
                  height: virtualRow.size,
                  width: virtualCol.size,
                }}
              />
            ))
          )}

          {/* Collaborator cursors */}
          <CollaboratorCursors
            getColumnWidth={getColumnWidth}
            getRowHeight={getRowHeight}
          />
        </div>
      </div>
    </div>
  );
}
