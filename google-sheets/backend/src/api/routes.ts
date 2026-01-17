import express from 'express';
import { pool } from '../shared/db.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Express router for spreadsheet REST API endpoints.
 * Provides CRUD operations for spreadsheets, sheets, and cells.
 * Works alongside WebSocket for real-time collaboration.
 */
const router = express.Router();

/**
 * GET /spreadsheets
 * Lists all spreadsheets ordered by last update time.
 * Returns spreadsheet metadata including sheet count.
 *
 * @returns Array of spreadsheet objects with sheet counts
 */
router.get('/spreadsheets', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM sheets WHERE spreadsheet_id = s.id) as sheet_count
      FROM spreadsheets s
      ORDER BY s.updated_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listing spreadsheets:', error);
    res.status(500).json({ error: 'Failed to list spreadsheets' });
  }
});

/**
 * POST /spreadsheets
 * Creates a new spreadsheet with an optional title.
 * Automatically creates a default "Sheet1" sheet.
 *
 * @param req.body.title - Optional title (defaults to "Untitled Spreadsheet")
 * @returns The created spreadsheet with its initial sheet
 */
router.post('/spreadsheets', async (req, res) => {
  const { title = 'Untitled Spreadsheet' } = req.body;
  const id = uuidv4();

  try {
    // Create spreadsheet
    await pool.query(
      'INSERT INTO spreadsheets (id, title) VALUES ($1, $2)',
      [id, title]
    );

    // Create default sheet
    const sheetId = uuidv4();
    await pool.query(
      'INSERT INTO sheets (id, spreadsheet_id, name, sheet_index) VALUES ($1, $2, $3, 0)',
      [sheetId, id, 'Sheet1']
    );

    res.status(201).json({
      id,
      title,
      sheets: [{ id: sheetId, name: 'Sheet1', sheet_index: 0 }],
    });
  } catch (error) {
    console.error('Error creating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to create spreadsheet' });
  }
});

/**
 * GET /spreadsheets/:id
 * Retrieves a spreadsheet by ID with all its sheets.
 *
 * @param req.params.id - The spreadsheet UUID
 * @returns The spreadsheet object with sheets array, or 404 if not found
 */
router.get('/spreadsheets/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const spreadsheetResult = await pool.query(
      'SELECT * FROM spreadsheets WHERE id = $1',
      [id]
    );

    if (spreadsheetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const sheetsResult = await pool.query(
      'SELECT * FROM sheets WHERE spreadsheet_id = $1 ORDER BY sheet_index',
      [id]
    );

    res.json({
      ...spreadsheetResult.rows[0],
      sheets: sheetsResult.rows,
    });
  } catch (error) {
    console.error('Error getting spreadsheet:', error);
    res.status(500).json({ error: 'Failed to get spreadsheet' });
  }
});

/**
 * PATCH /spreadsheets/:id
 * Updates a spreadsheet's title.
 *
 * @param req.params.id - The spreadsheet UUID
 * @param req.body.title - The new title
 * @returns The updated spreadsheet ID and title
 */
router.patch('/spreadsheets/:id', async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    await pool.query(
      'UPDATE spreadsheets SET title = $1, updated_at = NOW() WHERE id = $2',
      [title, id]
    );
    res.json({ id, title });
  } catch (error) {
    console.error('Error updating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to update spreadsheet' });
  }
});

/**
 * DELETE /spreadsheets/:id
 * Deletes a spreadsheet and all associated data (cascading).
 *
 * @param req.params.id - The spreadsheet UUID to delete
 * @returns 204 No Content on success
 */
router.delete('/spreadsheets/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM spreadsheets WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting spreadsheet:', error);
    res.status(500).json({ error: 'Failed to delete spreadsheet' });
  }
});

/**
 * POST /spreadsheets/:id/sheets
 * Adds a new sheet to a spreadsheet.
 * Automatically assigns the next sheet index.
 *
 * @param req.params.id - The spreadsheet UUID
 * @param req.body.name - Optional sheet name (defaults to "New Sheet")
 * @returns The created sheet object
 */
router.post('/spreadsheets/:id/sheets', async (req, res) => {
  const { id } = req.params;
  const { name = 'New Sheet' } = req.body;

  try {
    // Get next sheet index
    const indexResult = await pool.query(
      'SELECT COALESCE(MAX(sheet_index), -1) + 1 as next_index FROM sheets WHERE spreadsheet_id = $1',
      [id]
    );
    const nextIndex = indexResult.rows[0].next_index;

    const sheetId = uuidv4();
    await pool.query(
      'INSERT INTO sheets (id, spreadsheet_id, name, sheet_index) VALUES ($1, $2, $3, $4)',
      [sheetId, id, name, nextIndex]
    );

    res.status(201).json({ id: sheetId, name, sheet_index: nextIndex });
  } catch (error) {
    console.error('Error adding sheet:', error);
    res.status(500).json({ error: 'Failed to add sheet' });
  }
});

/**
 * GET /sheets/:sheetId/cells
 * Retrieves all cells for a specific sheet.
 * Returns a sparse map with "row-col" keys for efficient storage.
 *
 * @param req.params.sheetId - The sheet UUID
 * @returns Object with cell keys mapping to cell data (rawValue, computedValue, format)
 */
router.get('/sheets/:sheetId/cells', async (req, res) => {
  const { sheetId } = req.params;

  try {
    const cellsResult = await pool.query(
      'SELECT row_index, col_index, raw_value, computed_value, format FROM cells WHERE sheet_id = $1',
      [sheetId]
    );

    const cells: Record<string, any> = {};
    for (const cell of cellsResult.rows) {
      const key = `${cell.row_index}-${cell.col_index}`;
      cells[key] = {
        rawValue: cell.raw_value,
        computedValue: cell.computed_value,
        format: cell.format,
      };
    }

    res.json(cells);
  } catch (error) {
    console.error('Error getting cells:', error);
    res.status(500).json({ error: 'Failed to get cells' });
  }
});

/**
 * PATCH /sheets/:sheetId/cells
 * Batch updates multiple cells in a single transaction.
 * Uses upsert to insert or update cells efficiently.
 *
 * @param req.params.sheetId - The sheet UUID
 * @param req.body.changes - Array of {row, col, value} objects
 * @returns Count of updated cells
 */
router.patch('/sheets/:sheetId/cells', async (req, res) => {
  const { sheetId } = req.params;
  const { changes } = req.body; // Array of { row, col, value }

  if (!Array.isArray(changes)) {
    return res.status(400).json({ error: 'Changes must be an array' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const change of changes) {
        const { row, col, value } = change;
        await client.query(`
          INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value)
          VALUES ($1, $2, $3, $4, $4)
          ON CONFLICT (sheet_id, row_index, col_index)
          DO UPDATE SET raw_value = $4, computed_value = $4, updated_at = NOW()
        `, [sheetId, row, col, value]);
      }

      await client.query('COMMIT');
      res.json({ updated: changes.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error batch updating cells:', error);
    res.status(500).json({ error: 'Failed to update cells' });
  }
});

/**
 * GET /spreadsheets/:id/export
 * Exports a spreadsheet sheet to CSV format.
 * Uses computed values for formula cells.
 *
 * @param req.params.id - The spreadsheet UUID
 * @param req.query.format - Export format (currently only 'csv' supported)
 * @param req.query.sheetId - Optional specific sheet to export (defaults to first sheet)
 * @returns CSV file download
 */
router.get('/spreadsheets/:id/export', async (req, res) => {
  const { id } = req.params;
  const { format = 'csv', sheetId } = req.query;

  try {
    // Get the sheet (first one if not specified)
    let targetSheetId = sheetId;
    if (!targetSheetId) {
      const sheetResult = await pool.query(
        'SELECT id FROM sheets WHERE spreadsheet_id = $1 ORDER BY sheet_index LIMIT 1',
        [id]
      );
      if (sheetResult.rows.length === 0) {
        return res.status(404).json({ error: 'No sheets found' });
      }
      targetSheetId = sheetResult.rows[0].id;
    }

    // Get all cells
    const cellsResult = await pool.query(
      'SELECT row_index, col_index, computed_value FROM cells WHERE sheet_id = $1 ORDER BY row_index, col_index',
      [targetSheetId]
    );

    // Build cell map
    const cells = new Map<string, string>();
    let maxRow = 0;
    let maxCol = 0;

    for (const cell of cellsResult.rows) {
      cells.set(`${cell.row_index}-${cell.col_index}`, cell.computed_value || '');
      maxRow = Math.max(maxRow, cell.row_index);
      maxCol = Math.max(maxCol, cell.col_index);
    }

    // Generate CSV
    const rows: string[] = [];
    for (let row = 0; row <= maxRow; row++) {
      const cols: string[] = [];
      for (let col = 0; col <= maxCol; col++) {
        const value = cells.get(`${row}-${col}`) || '';
        // Escape for CSV
        const escaped = value.includes(',') || value.includes('"') || value.includes('\n')
          ? `"${value.replace(/"/g, '""')}"`
          : value;
        cols.push(escaped);
      }
      rows.push(cols.join(','));
    }

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="spreadsheet-${id}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting spreadsheet:', error);
    res.status(500).json({ error: 'Failed to export spreadsheet' });
  }
});

export default router;
