/**
 * Sheet dimension and metadata operations.
 * Handles column/row resizing and sheet renaming.
 *
 * @module websocket/sheet-operations
 */

import { pool } from '../shared/db.js';
import { createChildLogger } from '../shared/logger.js';
import { wsMessagesSent, errorsTotal, dbQueryDuration } from '../shared/metrics.js';
import { ExtendedWebSocket, ResizeColumnPayload, ResizeRowPayload, RenameSheetPayload } from './types.js';
import { broadcastToRoom } from './connection-manager.js';

/** Logger for sheet operations */
const sheetLogger = createChildLogger({ component: 'sheet-operations' });

/**
 * Handles column resize operations from clients.
 * Persists the new width to the database and broadcasts to collaborators.
 *
 * @param ws - The WebSocket connection that resized the column
 * @param payload - Contains sheetId, col index, and new width
 */
export async function handleResizeColumn(
  ws: ExtendedWebSocket,
  payload: ResizeColumnPayload
): Promise<void> {
  const { sheetId, col, width } = payload;

  try {
    const dbStart = Date.now();
    await pool.query(`
      INSERT INTO column_widths (sheet_id, col_index, width)
      VALUES ($1, $2, $3)
      ON CONFLICT (sheet_id, col_index)
      DO UPDATE SET width = $3
    `, [sheetId, col, width]);
    dbQueryDuration.labels('upsert_column_width').observe(Date.now() - dbStart);

    const sentCount = broadcastToRoom(ws.spreadsheetId!, {
      type: 'COLUMN_RESIZED',
      sheetId,
      col,
      width,
      userId: ws.userId,
    });

    wsMessagesSent.labels('COLUMN_RESIZED').inc(sentCount > 0 ? sentCount : 1);
  } catch (error) {
    errorsTotal.labels('resize_column', 'websocket').inc();
    sheetLogger.error({ error, sheetId, col }, 'Error resizing column');
  }
}

/**
 * Handles row resize operations from clients.
 * Persists the new height to the database and broadcasts to collaborators.
 *
 * @param ws - The WebSocket connection that resized the row
 * @param payload - Contains sheetId, row index, and new height
 */
export async function handleResizeRow(
  ws: ExtendedWebSocket,
  payload: ResizeRowPayload
): Promise<void> {
  const { sheetId, row, height } = payload;

  try {
    const dbStart = Date.now();
    await pool.query(`
      INSERT INTO row_heights (sheet_id, row_index, height)
      VALUES ($1, $2, $3)
      ON CONFLICT (sheet_id, row_index)
      DO UPDATE SET height = $3
    `, [sheetId, row, height]);
    dbQueryDuration.labels('upsert_row_height').observe(Date.now() - dbStart);

    const sentCount = broadcastToRoom(ws.spreadsheetId!, {
      type: 'ROW_RESIZED',
      sheetId,
      row,
      height,
      userId: ws.userId,
    });

    wsMessagesSent.labels('ROW_RESIZED').inc(sentCount > 0 ? sentCount : 1);
  } catch (error) {
    errorsTotal.labels('resize_row', 'websocket').inc();
    sheetLogger.error({ error, sheetId, row }, 'Error resizing row');
  }
}

/**
 * Handles sheet rename operations from clients.
 * Updates the sheet name in the database and broadcasts to collaborators.
 *
 * @param ws - The WebSocket connection that renamed the sheet
 * @param payload - Contains sheetId and new name
 */
export async function handleRenameSheet(
  ws: ExtendedWebSocket,
  payload: RenameSheetPayload
): Promise<void> {
  const { sheetId, name } = payload;

  try {
    const dbStart = Date.now();
    await pool.query('UPDATE sheets SET name = $1 WHERE id = $2', [name, sheetId]);
    dbQueryDuration.labels('update_sheet_name').observe(Date.now() - dbStart);

    const sentCount = broadcastToRoom(ws.spreadsheetId!, {
      type: 'SHEET_RENAMED',
      sheetId,
      name,
      userId: ws.userId,
    });

    wsMessagesSent.labels('SHEET_RENAMED').inc(sentCount > 0 ? sentCount : 1);
  } catch (error) {
    errorsTotal.labels('rename_sheet', 'websocket').inc();
    sheetLogger.error({ error, sheetId, name }, 'Error renaming sheet');
  }
}
