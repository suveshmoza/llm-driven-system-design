# Google Sheets - Architecture

A collaborative spreadsheet application with real-time multi-user editing, formula support, and Excel-like interactions.

## System Overview

### Core Requirements

**Functional:**
- Create, open, and edit spreadsheets
- Real-time collaboration (multiple users editing simultaneously)
- Formula calculation with dependency tracking
- Cell formatting (bold, colors, alignment)
- Copy/paste with clipboard integration
- Undo/redo with history management
- Column/row resizing
- Keyboard navigation (arrows, Tab, Enter)

**Non-Functional:**
- Support 10,000+ rows/columns via virtualization
- Sub-100ms latency for local edits
- Conflict resolution for concurrent edits
- Offline support with sync on reconnect

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Clients                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Browser 1  │  │   Browser 2  │  │   Browser 3  │              │
│  │ (User Alice) │  │  (User Bob)  │  │ (User Carol) │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                        │
│         │    WebSocket    │    WebSocket    │                        │
│         └────────┬────────┴────────┬────────┘                        │
│                  │                 │                                 │
│                  ▼                 ▼                                 │
│         ┌────────────────────────────────────┐                      │
│         │        WebSocket Server            │                      │
│         │   (Real-time Collaboration Hub)    │                      │
│         └────────────────┬───────────────────┘                      │
│                          │                                           │
│         ┌────────────────┴───────────────────┐                      │
│         ▼                                    ▼                      │
│  ┌──────────────┐                   ┌──────────────┐               │
│  │  REST API    │                   │    Redis     │               │
│  │  (CRUD ops)  │                   │  (Pub/Sub +  │               │
│  │              │                   │   Sessions)  │               │
│  └──────┬───────┘                   └──────────────┘               │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │  PostgreSQL  │                                                   │
│  │ (Persistence)│                                                   │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Model

### PostgreSQL Schema

```sql
-- Spreadsheets (documents)
CREATE TABLE spreadsheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Spreadsheet',
    owner_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Sheets within a spreadsheet
CREATE TABLE sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spreadsheet_id UUID REFERENCES spreadsheets(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Sheet1',
    index INTEGER NOT NULL DEFAULT 0,
    frozen_rows INTEGER DEFAULT 0,
    frozen_cols INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Cell data (sparse storage - only non-empty cells)
CREATE TABLE cells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    col_index INTEGER NOT NULL,
    raw_value TEXT,           -- User input (formula or value)
    computed_value TEXT,      -- Calculated result
    format JSONB,             -- {bold, italic, color, bgColor, align, fontSize}
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(sheet_id, row_index, col_index)
);

-- Column/row dimensions
CREATE TABLE column_widths (
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    col_index INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 100,
    PRIMARY KEY (sheet_id, col_index)
);

CREATE TABLE row_heights (
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    height INTEGER NOT NULL DEFAULT 32,
    PRIMARY KEY (sheet_id, row_index)
);

-- Active collaborators
CREATE TABLE collaborators (
    spreadsheet_id UUID REFERENCES spreadsheets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    cursor_row INTEGER,
    cursor_col INTEGER,
    color VARCHAR(7),         -- User color for presence
    joined_at TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (spreadsheet_id, session_id)
);

-- Edit history for undo/redo
CREATE TABLE edit_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- SET_CELL, DELETE_CELL, RESIZE, etc.
    operation_data JSONB NOT NULL,
    inverse_data JSONB NOT NULL,         -- For undo
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_cells_sheet ON cells(sheet_id);
CREATE INDEX idx_cells_position ON cells(sheet_id, row_index, col_index);
CREATE INDEX idx_collaborators_spreadsheet ON collaborators(spreadsheet_id);
CREATE INDEX idx_edit_history_sheet ON edit_history(sheet_id, created_at DESC);
```

### Cell Data Structure

```typescript
interface CellData {
  rawValue: string | null;      // User input
  computedValue: any;           // Calculated result
  formula?: string;             // If starts with '='
  format?: CellFormat;
  error?: string;               // Formula error
}

interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontSize?: number;
  numberFormat?: string;        // Currency, percentage, date
}
```

## Real-Time Collaboration

### WebSocket Protocol

#### Connection Flow

```
1. Client connects: ws://server/ws?spreadsheetId=xxx&token=yyy
2. Server authenticates token
3. Server adds client to spreadsheet room
4. Server broadcasts user presence to room
5. Server sends current state to new client
```

#### Message Types

**Client → Server:**
```typescript
// Cell edit
{ type: 'CELL_EDIT', sheetId, row, col, value }

// Selection change
{ type: 'SELECTION_CHANGE', sheetId, range: { startRow, startCol, endRow, endCol } }

// Cursor move
{ type: 'CURSOR_MOVE', sheetId, row, col }

// Resize column/row
{ type: 'RESIZE', sheetId, axis: 'row' | 'column', index, size }

// Request undo
{ type: 'UNDO', sheetId }

// Request redo
{ type: 'REDO', sheetId }
```

**Server → Client:**
```typescript
// Cell updated (broadcast)
{ type: 'CELL_UPDATED', sheetId, row, col, value, computedValue, userId }

// User joined
{ type: 'USER_JOINED', userId, name, color }

// User left
{ type: 'USER_LEFT', userId }

// Cursor moved (other user)
{ type: 'CURSOR_MOVED', userId, row, col }

// Selection changed (other user)
{ type: 'SELECTION_CHANGED', userId, range }

// Full state sync (on connect)
{ type: 'STATE_SYNC', cells: Map<string, CellData>, collaborators: User[] }

// Undo/redo result
{ type: 'HISTORY_APPLIED', operation, direction: 'undo' | 'redo' }
```

### Conflict Resolution

Using **Operational Transformation (OT)** simplified approach:

1. **Last-Write-Wins per Cell**: Each cell is an independent unit
2. **Server is Source of Truth**: All edits go through server
3. **Optimistic Updates**: Client applies locally, reverts if server rejects

```typescript
// Client-side optimistic update
function handleCellEdit(row, col, value) {
  // 1. Apply locally immediately
  localState.setCell(row, col, value);

  // 2. Send to server with version
  ws.send({ type: 'CELL_EDIT', row, col, value, version: localVersion });

  // 3. Server broadcasts confirmed change
  // 4. If version conflict, server sends authoritative value
}

// Server-side handling
function handleCellEdit(clientId, edit) {
  const cell = await db.getCell(edit.sheetId, edit.row, edit.col);

  // Simple last-write-wins
  await db.updateCell(edit.sheetId, edit.row, edit.col, edit.value);

  // Recalculate formulas that depend on this cell
  const affectedCells = formulaEngine.recalculate(edit.row, edit.col);

  // Broadcast to all clients in room
  broadcastToRoom(edit.sheetId, {
    type: 'CELL_UPDATED',
    row: edit.row,
    col: edit.col,
    value: edit.value,
    computedValue: cell.computedValue,
    affectedCells,
    userId: clientId
  });
}
```

### Presence Indicators

```typescript
interface Collaborator {
  userId: string;
  name: string;
  color: string;          // Unique color per user
  cursorPosition: { row: number; col: number } | null;
  selection: CellRange | null;
}

// Colors assigned in order
const COLLABORATOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
];
```

## Formula Engine

### HyperFormula Integration

```typescript
import { HyperFormula } from 'hyperformula';

class FormulaEngine {
  private hf: HyperFormula;
  private sheetId: number;

  constructor() {
    this.hf = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      useArrayArithmetic: true,
    });
    this.sheetId = this.hf.addSheet('Sheet1');
  }

  setCellValue(row: number, col: number, value: string): CellResult {
    if (value.startsWith('=')) {
      // Formula
      this.hf.setCellContents({ sheet: this.sheetId, row, col }, value);
    } else {
      // Plain value
      const parsed = this.parseValue(value);
      this.hf.setCellContents({ sheet: this.sheetId, row, col }, [[parsed]]);
    }

    return {
      computedValue: this.hf.getCellValue({ sheet: this.sheetId, row, col }),
      dependents: this.getDependentCells(row, col),
    };
  }

  getDependentCells(row: number, col: number): Array<{row: number, col: number}> {
    // Get cells that depend on this cell and need recalculation
    return this.hf.getCellDependents({ sheet: this.sheetId, row, col })
      .map(addr => ({ row: addr.row, col: addr.col }));
  }

  private parseValue(value: string): any {
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    return value;
  }
}
```

### Supported Functions

HyperFormula provides 380+ Excel-compatible functions:

- **Math**: SUM, AVERAGE, MAX, MIN, COUNT, ROUND, ABS, SQRT
- **Text**: CONCAT, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER
- **Logical**: IF, AND, OR, NOT, IFERROR
- **Lookup**: VLOOKUP, HLOOKUP, INDEX, MATCH
- **Date**: TODAY, NOW, DATE, YEAR, MONTH, DAY
- **Statistical**: MEDIAN, STDEV, VAR, CORREL

## Frontend Architecture

### Component Hierarchy

```
<SpreadsheetApp>
├── <Toolbar>
│   ├── <FormatButtons>
│   ├── <FormulaBar>
│   └── <ShareButton>
├── <SheetTabs>
├── <SpreadsheetGrid>
│   ├── <ColumnHeaders> (frozen)
│   ├── <RowHeaders> (frozen)
│   ├── <VirtualizedCells>
│   │   └── <Cell> (memoized)
│   ├── <SelectionOverlay>
│   └── <CollaboratorCursors>
└── <StatusBar>
```

### State Management (Zustand)

```typescript
interface SpreadsheetStore {
  // Document state
  spreadsheetId: string;
  sheets: Sheet[];
  activeSheetId: string;

  // Cell data (sparse map)
  cells: Map<string, CellData>;  // key: "sheetId-row-col"

  // Selection
  activeCell: { row: number; col: number } | null;
  selection: CellRange | null;

  // Collaborators
  collaborators: Map<string, Collaborator>;

  // Dimensions
  columnWidths: Map<number, number>;
  rowHeights: Map<number, number>;

  // History
  undoStack: Operation[];
  redoStack: Operation[];

  // Actions
  setCell: (row: number, col: number, value: string) => void;
  setSelection: (range: CellRange) => void;
  resizeColumn: (col: number, width: number) => void;
  resizeRow: (row: number, height: number) => void;
  undo: () => void;
  redo: () => void;
}
```

### Virtualization Strategy

Using TanStack Virtual for efficient rendering:

```typescript
const rowVirtualizer = useVirtualizer({
  count: MAX_ROWS,              // 1,000,000 rows
  getScrollElement: () => containerRef.current,
  estimateSize: (index) => rowHeights.get(index) ?? 32,
  overscan: 10,                 // Render 10 extra rows
});

const columnVirtualizer = useVirtualizer({
  horizontal: true,
  count: MAX_COLS,              // 16,384 columns (like Excel)
  getScrollElement: () => containerRef.current,
  estimateSize: (index) => columnWidths.get(index) ?? 100,
  overscan: 5,
});
```

## API Design

### REST Endpoints

```
# Spreadsheets
GET    /api/spreadsheets              # List user's spreadsheets
POST   /api/spreadsheets              # Create new spreadsheet
GET    /api/spreadsheets/:id          # Get spreadsheet with sheets
DELETE /api/spreadsheets/:id          # Delete spreadsheet

# Sheets
POST   /api/spreadsheets/:id/sheets   # Add sheet
PATCH  /api/sheets/:sheetId           # Update sheet (rename, reorder)
DELETE /api/sheets/:sheetId           # Delete sheet

# Cells (for initial load and batch operations)
GET    /api/sheets/:sheetId/cells     # Get all cells (with pagination)
PATCH  /api/sheets/:sheetId/cells     # Batch update cells

# Export
GET    /api/spreadsheets/:id/export?format=csv|xlsx
```

### WebSocket Events

See "Real-Time Collaboration" section above.

## Performance Optimizations

### 1. Sparse Cell Storage
Only store non-empty cells in database and state.

### 2. Lazy Loading
Load cell data in viewport chunks, not entire sheet.

### 3. Debounced Saves
Batch cell updates before persisting:

```typescript
const debouncedSave = useDebouncedCallback(
  (changes: CellChange[]) => {
    api.batchUpdateCells(sheetId, changes);
  },
  500 // Save after 500ms of inactivity
);
```

### 4. Web Workers for Formulas
Offload formula calculation to prevent UI blocking:

```typescript
// formula.worker.ts
const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });

self.onmessage = ({ data }) => {
  if (data.type === 'CALCULATE') {
    hf.setCellContents(data.address, data.value);
    const result = hf.getCellValue(data.address);
    self.postMessage({ type: 'RESULT', address: data.address, value: result });
  }
};
```

### 5. Memoized Cell Rendering

```typescript
const Cell = memo(function Cell({ row, col, data, isSelected, isActive }) {
  // ...
}, (prev, next) => {
  return prev.row === next.row &&
         prev.col === next.col &&
         prev.data === next.data &&
         prev.isSelected === next.isSelected &&
         prev.isActive === next.isActive;
});
```

## Scalability Considerations

### Horizontal Scaling

```
                    Load Balancer
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │ Server1 │    │ Server2 │    │ Server3 │
    └────┬────┘    └────┬────┘    └────┬────┘
         │              │              │
         └──────────────┼──────────────┘
                        ▼
                  ┌───────────┐
                  │   Redis   │  ← Pub/Sub for cross-server sync
                  │  Cluster  │
                  └───────────┘
```

### Redis Pub/Sub for Multi-Server

```typescript
// When edit comes in on Server1
redis.publish(`spreadsheet:${spreadsheetId}`, JSON.stringify({
  type: 'CELL_UPDATED',
  ...editData
}));

// All servers subscribe
redis.subscribe(`spreadsheet:${spreadsheetId}`, (message) => {
  // Broadcast to local WebSocket clients
  wsServer.broadcastToRoom(spreadsheetId, message);
});
```

## Security

### Authentication
- Session-based auth stored in Redis
- WebSocket connection requires valid session token

### Authorization
- Check spreadsheet permissions before allowing edits
- Rate limiting on edit operations

### Data Validation
- Sanitize formula inputs (prevent code injection)
- Validate cell coordinates
- Limit maximum spreadsheet/cell size

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 19, TypeScript, Vite |
| Virtualization | TanStack Virtual |
| State Management | Zustand |
| Formulas | HyperFormula |
| Backend | Node.js, Express |
| WebSocket | ws library |
| Database | PostgreSQL |
| Cache/Pub-Sub | Redis |
| Containerization | Docker Compose |

## References

- [TanStack Virtual Documentation](https://tanstack.com/virtual/latest)
- [HyperFormula Guide](https://hyperformula.handsontable.com/)
- [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation)
- [Google Sheets API Design](https://developers.google.com/sheets/api/reference/rest)
- [Excel Online Architecture](https://docs.microsoft.com/en-us/office/dev/add-ins/excel/)
