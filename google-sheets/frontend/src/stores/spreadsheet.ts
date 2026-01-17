/**
 * Zustand store for spreadsheet state management.
 * Handles real-time collaboration, cell editing, selection, and WebSocket communication.
 * Uses sparse cell storage for efficient memory usage with large grids.
 *
 * @module stores/spreadsheet
 */

import { create } from 'zustand';

/**
 * Represents the data and computed value of a single cell.
 * Uses sparse storage - only non-empty cells are stored.
 */
export interface CellData {
  rawValue: string | null;
  computedValue: string | null;
  format?: CellFormat;
}

/**
 * Cell formatting options for visual presentation.
 * Applied per-cell and synced across collaborators.
 */
export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontSize?: number;
}

/**
 * Defines a rectangular range of cells for selection.
 * Used for both user selection and collaborator highlighting.
 */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Represents a connected collaborator with their presence state.
 * Color is assigned server-side for visual distinction.
 */
export interface Collaborator {
  userId: string;
  name: string;
  color: string;
  cursor?: { row: number; col: number };
  selection?: CellRange;
}

/**
 * Represents a single sheet within a spreadsheet.
 * Each spreadsheet can contain multiple sheets.
 */
export interface Sheet {
  id: string;
  name: string;
  sheet_index: number;
}

/**
 * Complete spreadsheet state and actions interface.
 * Combines document state, selection state, and collaboration features.
 */
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

/** Default column width in pixels */
const DEFAULT_COLUMN_WIDTH = 100;

/** Default row height in pixels */
const DEFAULT_ROW_HEIGHT = 32;

/**
 * Main Zustand store for spreadsheet state.
 * Provides reactive state updates and actions for the spreadsheet UI.
 */
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

  /**
   * Establishes WebSocket connection to the collaboration server.
   * Sets up message handlers for real-time sync.
   *
   * @param spreadsheetId - The spreadsheet to connect to
   * @param userName - Display name for this user
   */
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

  /**
   * Closes the WebSocket connection and resets state.
   * Should be called on component unmount.
   */
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

  /**
   * Updates a cell value and sends it to the server.
   * Uses optimistic update for immediate UI feedback.
   *
   * @param row - Cell row index (0-based)
   * @param col - Cell column index (0-based)
   * @param value - The raw cell value (may include formulas)
   */
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

  /**
   * Retrieves cell data for a specific position.
   *
   * @param row - Cell row index (0-based)
   * @param col - Cell column index (0-based)
   * @returns CellData if cell exists, undefined otherwise
   */
  getCell: (row: number, col: number) => {
    return get().cells.get(`${row}-${col}`);
  },

  /**
   * Sets the active cell and notifies collaborators.
   * Also initializes a single-cell selection.
   *
   * @param row - Cell row index (0-based)
   * @param col - Cell column index (0-based)
   */
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

  /**
   * Sets the current selection range and notifies collaborators.
   *
   * @param range - The cell range to select, or null to clear
   */
  setSelection: (range: CellRange | null) => {
    const { ws } = get();
    set({ selection: range });

    if (ws && ws.readyState === WebSocket.OPEN && range) {
      ws.send(JSON.stringify({ type: 'SELECTION_CHANGE', range }));
    }
  },

  /** Begins a drag selection operation */
  startSelecting: () => set({ isSelecting: true }),

  /** Ends a drag selection operation */
  stopSelecting: () => set({ isSelecting: false }),

  /**
   * Extends the current selection to include the specified cell.
   * Only works while isSelecting is true.
   *
   * @param row - Target row to extend selection to
   * @param col - Target column to extend selection to
   */
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

  /**
   * Enters edit mode for a cell.
   * Loads existing cell value into the edit buffer.
   *
   * @param row - Cell row to edit
   * @param col - Cell column to edit
   */
  startEditing: (row: number, col: number) => {
    const cell = get().getCell(row, col);
    set({
      editingCell: { row, col },
      editValue: cell?.rawValue || '',
    });
  },

  /**
   * Updates the current edit buffer value.
   *
   * @param value - The new edit value
   */
  setEditValue: (value: string) => {
    set({ editValue: value });
  },

  /**
   * Commits the current edit to the cell and exits edit mode.
   * Sends the change to the server.
   */
  commitEdit: () => {
    const { editingCell, editValue, setCell } = get();
    if (editingCell) {
      setCell(editingCell.row, editingCell.col, editValue);
    }
    set({ editingCell: null, editValue: '' });
  },

  /** Cancels the current edit and exits edit mode without saving */
  cancelEdit: () => {
    set({ editingCell: null, editValue: '' });
  },

  /**
   * Resizes a column and broadcasts to collaborators.
   *
   * @param col - Column index to resize
   * @param width - New width in pixels
   */
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

  /**
   * Resizes a row and broadcasts to collaborators.
   *
   * @param row - Row index to resize
   * @param height - New height in pixels
   */
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

  /**
   * Checks if a cell is within the current selection.
   *
   * @param row - Cell row to check
   * @param col - Cell column to check
   * @returns true if cell is selected
   */
  isSelected: (row: number, col: number) => {
    const { selection } = get();
    if (!selection) return false;

    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);

    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  },

  /**
   * Checks if a cell is the currently active cell.
   *
   * @param row - Cell row to check
   * @param col - Cell column to check
   * @returns true if cell is the active cell
   */
  isActiveCell: (row: number, col: number) => {
    const { activeCell } = get();
    return activeCell?.row === row && activeCell?.col === col;
  },

  /**
   * Moves the active cell in the specified direction.
   * Handles keyboard navigation (arrow keys).
   *
   * @param direction - Direction to move: up, down, left, or right
   */
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

/**
 * Processes incoming WebSocket messages and updates store state.
 * Handles state sync, cell updates, and collaborator presence.
 *
 * @param message - The parsed WebSocket message
 * @param set - Zustand set function
 * @param get - Zustand get function
 */
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

/**
 * Converts a 0-based column index to a spreadsheet column letter.
 * Supports multi-letter columns (A, B, ..., Z, AA, AB, ...).
 *
 * @param index - 0-based column index
 * @returns Column letter(s) like 'A', 'B', 'AA', etc.
 */
export function getColumnLetter(index: number): string {
  let letter = '';
  let num = index;

  while (num >= 0) {
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26) - 1;
  }

  return letter;
}
