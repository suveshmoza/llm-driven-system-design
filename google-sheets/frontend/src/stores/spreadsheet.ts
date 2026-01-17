import { create } from 'zustand';

export interface CellData {
  rawValue: string | null;
  computedValue: string | null;
  format?: CellFormat;
}

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontSize?: number;
}

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface Collaborator {
  userId: string;
  name: string;
  color: string;
  cursor?: { row: number; col: number };
  selection?: CellRange;
}

export interface Sheet {
  id: string;
  name: string;
  sheet_index: number;
}

interface SpreadsheetState {
  // Connection
  spreadsheetId: string | null;
  isConnected: boolean;
  ws: WebSocket | null;

  // User
  userId: string | null;
  userName: string;
  userColor: string;

  // Document state
  title: string;
  sheets: Sheet[];
  activeSheetId: string | null;

  // Cell data (sparse map) - key: "row-col"
  cells: Map<string, CellData>;

  // Selection
  activeCell: { row: number; col: number } | null;
  selection: CellRange | null;
  isSelecting: boolean;

  // Collaborators
  collaborators: Map<string, Collaborator>;

  // Dimensions
  columnWidths: Map<number, number>;
  rowHeights: Map<number, number>;

  // Edit mode
  editingCell: { row: number; col: number } | null;
  editValue: string;

  // Actions
  connect: (spreadsheetId: string, userName?: string) => void;
  disconnect: () => void;

  setCell: (row: number, col: number, value: string) => void;
  getCell: (row: number, col: number) => CellData | undefined;

  setActiveCell: (row: number, col: number) => void;
  setSelection: (range: CellRange | null) => void;
  startSelecting: () => void;
  stopSelecting: () => void;
  extendSelection: (row: number, col: number) => void;

  startEditing: (row: number, col: number) => void;
  setEditValue: (value: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;

  resizeColumn: (col: number, width: number) => void;
  resizeRow: (row: number, height: number) => void;

  isSelected: (row: number, col: number) => boolean;
  isActiveCell: (row: number, col: number) => boolean;

  // Keyboard navigation
  moveActiveCell: (direction: 'up' | 'down' | 'left' | 'right') => void;
}

const DEFAULT_COLUMN_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 32;

export const useSpreadsheetStore = create<SpreadsheetState>((set, get) => ({
  // Initial state
  spreadsheetId: null,
  isConnected: false,
  ws: null,
  userId: null,
  userName: 'Anonymous',
  userColor: '#4ECDC4',
  title: 'Untitled Spreadsheet',
  sheets: [],
  activeSheetId: null,
  cells: new Map(),
  activeCell: null,
  selection: null,
  isSelecting: false,
  collaborators: new Map(),
  columnWidths: new Map(),
  rowHeights: new Map(),
  editingCell: null,
  editValue: '',

  connect: (spreadsheetId: string, userName = 'Anonymous') => {
    const wsUrl = `ws://localhost:3001/ws?spreadsheetId=${spreadsheetId}&name=${encodeURIComponent(userName)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ isConnected: true, spreadsheetId, userName });
      console.log('Connected to spreadsheet');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message, set, get);
    };

    ws.onclose = () => {
      set({ isConnected: false, ws: null });
      console.log('Disconnected from spreadsheet');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
    }
    set({
      ws: null,
      isConnected: false,
      spreadsheetId: null,
      cells: new Map(),
      collaborators: new Map(),
    });
  },

  setCell: (row: number, col: number, value: string) => {
    const { ws, activeSheetId, cells } = get();

    // Optimistic update
    const key = `${row}-${col}`;
    const newCells = new Map(cells);
    newCells.set(key, { rawValue: value, computedValue: value });
    set({ cells: newCells });

    // Send to server
    if (ws && ws.readyState === WebSocket.OPEN && activeSheetId) {
      ws.send(JSON.stringify({
        type: 'CELL_EDIT',
        sheetId: activeSheetId,
        row,
        col,
        value,
      }));
    }
  },

  getCell: (row: number, col: number) => {
    return get().cells.get(`${row}-${col}`);
  },

  setActiveCell: (row: number, col: number) => {
    const { ws } = get();
    set({
      activeCell: { row, col },
      selection: { startRow: row, startCol: col, endRow: row, endCol: col },
    });

    // Notify server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CURSOR_MOVE', row, col }));
    }
  },

  setSelection: (range: CellRange | null) => {
    const { ws } = get();
    set({ selection: range });

    if (ws && ws.readyState === WebSocket.OPEN && range) {
      ws.send(JSON.stringify({ type: 'SELECTION_CHANGE', range }));
    }
  },

  startSelecting: () => set({ isSelecting: true }),
  stopSelecting: () => set({ isSelecting: false }),

  extendSelection: (row: number, col: number) => {
    const { selection, isSelecting } = get();
    if (!isSelecting || !selection) return;

    set({
      selection: {
        ...selection,
        endRow: row,
        endCol: col,
      },
    });
  },

  startEditing: (row: number, col: number) => {
    const cell = get().getCell(row, col);
    set({
      editingCell: { row, col },
      editValue: cell?.rawValue || '',
    });
  },

  setEditValue: (value: string) => {
    set({ editValue: value });
  },

  commitEdit: () => {
    const { editingCell, editValue, setCell } = get();
    if (editingCell) {
      setCell(editingCell.row, editingCell.col, editValue);
    }
    set({ editingCell: null, editValue: '' });
  },

  cancelEdit: () => {
    set({ editingCell: null, editValue: '' });
  },

  resizeColumn: (col: number, width: number) => {
    const { ws, activeSheetId, columnWidths } = get();
    const newWidths = new Map(columnWidths);
    newWidths.set(col, width);
    set({ columnWidths: newWidths });

    if (ws && ws.readyState === WebSocket.OPEN && activeSheetId) {
      ws.send(JSON.stringify({
        type: 'RESIZE_COLUMN',
        sheetId: activeSheetId,
        col,
        width,
      }));
    }
  },

  resizeRow: (row: number, height: number) => {
    const { ws, activeSheetId, rowHeights } = get();
    const newHeights = new Map(rowHeights);
    newHeights.set(row, height);
    set({ rowHeights: newHeights });

    if (ws && ws.readyState === WebSocket.OPEN && activeSheetId) {
      ws.send(JSON.stringify({
        type: 'RESIZE_ROW',
        sheetId: activeSheetId,
        row,
        height,
      }));
    }
  },

  isSelected: (row: number, col: number) => {
    const { selection } = get();
    if (!selection) return false;

    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);

    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  },

  isActiveCell: (row: number, col: number) => {
    const { activeCell } = get();
    return activeCell?.row === row && activeCell?.col === col;
  },

  moveActiveCell: (direction) => {
    const { activeCell, setActiveCell } = get();
    if (!activeCell) {
      setActiveCell(0, 0);
      return;
    }

    let { row, col } = activeCell;

    switch (direction) {
      case 'up':
        row = Math.max(0, row - 1);
        break;
      case 'down':
        row++;
        break;
      case 'left':
        col = Math.max(0, col - 1);
        break;
      case 'right':
        col++;
        break;
    }

    setActiveCell(row, col);
  },
}));

// Handle incoming WebSocket messages
function handleWebSocketMessage(
  message: any,
  set: (partial: Partial<SpreadsheetState>) => void,
  get: () => SpreadsheetState
) {
  switch (message.type) {
    case 'STATE_SYNC': {
      const cells = new Map<string, CellData>();
      if (message.cells) {
        Object.entries(message.cells).forEach(([key, value]) => {
          cells.set(key, value as CellData);
        });
      }

      const columnWidths = new Map<number, number>();
      if (message.columnWidths) {
        Object.entries(message.columnWidths).forEach(([key, value]) => {
          columnWidths.set(parseInt(key), value as number);
        });
      }

      const rowHeights = new Map<number, number>();
      if (message.rowHeights) {
        Object.entries(message.rowHeights).forEach(([key, value]) => {
          rowHeights.set(parseInt(key), value as number);
        });
      }

      const collaborators = new Map<string, Collaborator>();
      if (message.collaborators) {
        message.collaborators.forEach((c: Collaborator) => {
          collaborators.set(c.userId, c);
        });
      }

      set({
        title: message.spreadsheet?.title || 'Untitled Spreadsheet',
        sheets: message.sheets || [],
        activeSheetId: message.activeSheetId,
        cells,
        columnWidths,
        rowHeights,
        collaborators,
        userId: message.user?.userId,
        userColor: message.user?.color,
      });
      break;
    }

    case 'CELL_UPDATED': {
      const { cells } = get();
      const newCells = new Map(cells);
      const key = `${message.row}-${message.col}`;
      newCells.set(key, {
        rawValue: message.rawValue,
        computedValue: message.computedValue,
      });
      set({ cells: newCells });
      break;
    }

    case 'USER_JOINED': {
      const { collaborators } = get();
      const newCollaborators = new Map(collaborators);
      newCollaborators.set(message.userId, {
        userId: message.userId,
        name: message.name,
        color: message.color,
      });
      set({ collaborators: newCollaborators });
      break;
    }

    case 'USER_LEFT': {
      const { collaborators } = get();
      const newCollaborators = new Map(collaborators);
      newCollaborators.delete(message.userId);
      set({ collaborators: newCollaborators });
      break;
    }

    case 'CURSOR_MOVED': {
      const { collaborators } = get();
      const newCollaborators = new Map(collaborators);
      const collab = newCollaborators.get(message.userId);
      if (collab) {
        newCollaborators.set(message.userId, {
          ...collab,
          cursor: { row: message.row, col: message.col },
        });
        set({ collaborators: newCollaborators });
      }
      break;
    }

    case 'SELECTION_CHANGED': {
      const { collaborators } = get();
      const newCollaborators = new Map(collaborators);
      const collab = newCollaborators.get(message.userId);
      if (collab) {
        newCollaborators.set(message.userId, {
          ...collab,
          selection: message.range,
        });
        set({ collaborators: newCollaborators });
      }
      break;
    }

    case 'COLUMN_RESIZED': {
      const { columnWidths } = get();
      const newWidths = new Map(columnWidths);
      newWidths.set(message.col, message.width);
      set({ columnWidths: newWidths });
      break;
    }

    case 'ROW_RESIZED': {
      const { rowHeights } = get();
      const newHeights = new Map(rowHeights);
      newHeights.set(message.row, message.height);
      set({ rowHeights: newHeights });
      break;
    }
  }
}

// Utility to get column letter (A, B, C, ..., Z, AA, AB, ...)
export function getColumnLetter(index: number): string {
  let letter = '';
  let num = index;

  while (num >= 0) {
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26) - 1;
  }

  return letter;
}
