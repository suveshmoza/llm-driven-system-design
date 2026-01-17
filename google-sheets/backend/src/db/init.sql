-- init.sql
-- Google Sheets collaborative spreadsheet - Complete database schema
-- Consolidated from all migrations for initial database setup
--
-- This file creates the complete schema in dependency order.
-- Use this for fresh database initialization.
-- For incremental updates, use the numbered migration files in ./migrations/

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- Stores user information with session-based authentication.
-- Simple auth model: users are identified by session_id, no password required.
--
-- Design decisions:
--   - UUID primary key for global uniqueness across distributed systems
--   - session_id is unique to identify returning users
--   - color field enables visual differentiation in collaboration UI
--   - last_seen supports cleanup of inactive users

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
    color VARCHAR(7) NOT NULL DEFAULT '#4ECDC4',  -- Hex color for cursor/presence
    created_at TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW()
);

-- Index for fast session lookups (used on every WebSocket connection)
CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_id);


-- ============================================================================
-- SPREADSHEETS TABLE
-- ============================================================================
-- Top-level document container. Each spreadsheet contains multiple sheets.
--
-- Design decisions:
--   - Soft reference to users (owner_id) allows orphaned spreadsheets if user deleted
--   - updated_at tracks last modification for sorting and caching invalidation

CREATE TABLE IF NOT EXISTS spreadsheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Spreadsheet',
    owner_id UUID REFERENCES users(id),  -- NULL if owner deleted
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);


-- ============================================================================
-- SHEETS TABLE
-- ============================================================================
-- Individual sheets within a spreadsheet (tabs at bottom of UI).
--
-- Design decisions:
--   - CASCADE delete ensures sheets are removed when parent spreadsheet deleted
--   - sheet_index allows reordering tabs
--   - frozen_rows/cols support Excel-like freeze panes feature

CREATE TABLE IF NOT EXISTS sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spreadsheet_id UUID REFERENCES spreadsheets(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Sheet1',
    sheet_index INTEGER NOT NULL DEFAULT 0,  -- Order of tabs
    frozen_rows INTEGER DEFAULT 0,           -- Number of frozen header rows
    frozen_cols INTEGER DEFAULT 0,           -- Number of frozen header columns
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast sheet lookup when loading a spreadsheet
CREATE INDEX IF NOT EXISTS idx_sheets_spreadsheet ON sheets(spreadsheet_id);


-- ============================================================================
-- CELLS TABLE
-- ============================================================================
-- Cell data storage using sparse representation.
-- Only non-empty cells are stored (empty cells do not exist in the table).
--
-- Design decisions:
--   - Sparse storage is efficient: a 1M cell sheet might only have 1000 rows
--   - raw_value stores user input (formulas start with '=')
--   - computed_value stores calculated result (for formulas) or NULL
--   - format stored as JSONB for flexible styling without schema changes
--   - UNIQUE constraint on (sheet_id, row_index, col_index) enables UPSERT
--   - updated_by tracks who made the last edit for audit/collaboration

CREATE TABLE IF NOT EXISTS cells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,              -- 0-based row number
    col_index INTEGER NOT NULL,              -- 0-based column number
    raw_value TEXT,                          -- User input (e.g., "=SUM(A1:A10)")
    computed_value TEXT,                     -- Calculated result (e.g., "150")
    format JSONB DEFAULT '{}',               -- {bold, italic, color, bgColor, align, fontSize}
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),    -- NULL if user deleted
    UNIQUE(sheet_id, row_index, col_index)   -- One cell per position
);

-- Primary lookup pattern: get cells for a sheet
CREATE INDEX IF NOT EXISTS idx_cells_sheet ON cells(sheet_id);

-- Secondary index for range queries (viewport loading)
CREATE INDEX IF NOT EXISTS idx_cells_position ON cells(sheet_id, row_index, col_index);


-- ============================================================================
-- COLUMN_WIDTHS TABLE
-- ============================================================================
-- Custom column widths (only stores non-default values).
-- Default width is 100px; only columns with different widths are stored.
--
-- Design decisions:
--   - Sparse storage pattern matches cells table
--   - Composite primary key (sheet_id, col_index) is natural unique identifier
--   - CASCADE delete cleans up when sheet is deleted

CREATE TABLE IF NOT EXISTS column_widths (
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    col_index INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 100,  -- Width in pixels
    PRIMARY KEY (sheet_id, col_index)
);


-- ============================================================================
-- ROW_HEIGHTS TABLE
-- ============================================================================
-- Custom row heights (only stores non-default values).
-- Default height is 32px; only rows with different heights are stored.
--
-- Design decisions:
--   - Mirror structure of column_widths for consistency
--   - Sparse storage for efficiency

CREATE TABLE IF NOT EXISTS row_heights (
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    height INTEGER NOT NULL DEFAULT 32,  -- Height in pixels
    PRIMARY KEY (sheet_id, row_index)
);


-- ============================================================================
-- COLLABORATORS TABLE
-- ============================================================================
-- Tracks active users in a spreadsheet for real-time collaboration.
-- This is ephemeral data; rows are cleaned up when users disconnect.
--
-- Design decisions:
--   - Composite primary key (spreadsheet_id, user_id) ensures one entry per user per document
--   - Cursor position supports showing other users' cursors
--   - Selection range supports showing other users' selected areas
--   - last_seen enables cleanup of stale connections (via background job)
--   - CASCADE delete ensures cleanup when spreadsheet or user is deleted

CREATE TABLE IF NOT EXISTS collaborators (
    spreadsheet_id UUID REFERENCES spreadsheets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    cursor_row INTEGER,              -- Current cursor row (NULL if not active)
    cursor_col INTEGER,              -- Current cursor column
    selection_start_row INTEGER,     -- Selection range start
    selection_start_col INTEGER,
    selection_end_row INTEGER,       -- Selection range end
    selection_end_col INTEGER,
    joined_at TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (spreadsheet_id, user_id)
);

-- Index for getting all collaborators in a spreadsheet (presence list)
CREATE INDEX IF NOT EXISTS idx_collaborators_spreadsheet ON collaborators(spreadsheet_id);


-- ============================================================================
-- EDIT_HISTORY TABLE
-- ============================================================================
-- Operation log for undo/redo functionality and audit trail.
-- Each entry represents one atomic operation that can be undone.
--
-- Design decisions:
--   - operation_type categorizes edits (SET_CELL, DELETE_CELL, RESIZE, PASTE, etc.)
--   - operation_data stores forward operation details as JSONB
--   - inverse_data stores reverse operation for undo
--   - Keeping both forward and inverse enables redo after undo
--   - Index on (sheet_id, created_at DESC) optimizes undo stack retrieval
--   - Soft reference to users allows history to persist if user deleted

CREATE TABLE IF NOT EXISTS edit_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),       -- NULL if user deleted
    operation_type VARCHAR(50) NOT NULL,     -- SET_CELL, DELETE_CELL, RESIZE, etc.
    operation_data JSONB NOT NULL,           -- Forward operation details
    inverse_data JSONB NOT NULL,             -- Reverse operation for undo
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for retrieving undo stack (most recent first)
CREATE INDEX IF NOT EXISTS idx_edit_history_sheet ON edit_history(sheet_id, created_at DESC);


-- ============================================================================
-- ENTITY RELATIONSHIPS SUMMARY
-- ============================================================================
--
-- users (1) ----< (many) spreadsheets      [owner relationship]
-- users (1) ----< (many) cells             [last editor]
-- users (1) ----< (many) collaborators     [active session]
-- users (1) ----< (many) edit_history      [operation author]
--
-- spreadsheets (1) ----< (many) sheets     [parent container, CASCADE]
-- spreadsheets (1) ----< (many) collaborators [active document, CASCADE]
--
-- sheets (1) ----< (many) cells            [cell container, CASCADE]
-- sheets (1) ----< (many) column_widths    [dimension customization, CASCADE]
-- sheets (1) ----< (many) row_heights      [dimension customization, CASCADE]
-- sheets (1) ----< (many) edit_history     [operation log, CASCADE]
--
-- ============================================================================
-- CASCADE DELETE BEHAVIOR
-- ============================================================================
--
-- When a spreadsheet is deleted:
--   - All sheets are deleted (CASCADE)
--   - All collaborator entries are deleted (CASCADE)
--
-- When a sheet is deleted:
--   - All cells are deleted (CASCADE)
--   - All column_widths are deleted (CASCADE)
--   - All row_heights are deleted (CASCADE)
--   - All edit_history entries are deleted (CASCADE)
--
-- When a user is deleted:
--   - Spreadsheets remain (owner_id becomes NULL via REFERENCES)
--   - Cells remain (updated_by becomes NULL via REFERENCES)
--   - Collaborator entries are deleted (CASCADE)
--   - Edit history remains (user_id becomes NULL via REFERENCES)
--
-- ============================================================================
