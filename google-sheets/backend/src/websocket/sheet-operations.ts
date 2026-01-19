/**
 * Sheet dimension and metadata operations.
 *
 * @description Handles sheet-level operations including column and row resizing,
 * and sheet renaming. All changes are persisted to PostgreSQL and broadcast
 * to collaborators in real-time. Includes metric tracking for performance monitoring.
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
 *
 * @description Persists a column width change to the database using an upsert operation,
 * then broadcasts the change to all collaborators in the room. Updates Prometheus
 * metrics for database query duration and message counts.
 *
 * @param {ExtendedWebSocket} ws - The WebSocket connection that resized the column
 * @param {ResizeColumnPayload} payload - Contains sheetId, column index, and new width in pixels
 * @returns {Promise<void>} Resolves when the resize has been persisted and broadcast
 *
 * @example
 * ```typescript
 * // When receiving a RESIZE_COLUMN message from client
 * await handleResizeColumn(ws, {
 *   sheetId: 'sheet-abc',
 *   col: 2,
 *   width: 150
 * });
 * // Column width saved to DB and broadcast to all room members
 * ```
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
 *
 * @description Persists a row height change to the database using an upsert operation,
 * then broadcasts the change to all collaborators in the room. Updates Prometheus
 * metrics for database query duration and message counts.
 *
 * @param {ExtendedWebSocket} ws - The WebSocket connection that resized the row
 * @param {ResizeRowPayload} payload - Contains sheetId, row index, and new height in pixels
 * @returns {Promise<void>} Resolves when the resize has been persisted and broadcast
 *
 * @example
 * ```typescript
 * // When receiving a RESIZE_ROW message from client
 * await handleResizeRow(ws, {
 *   sheetId: 'sheet-abc',
 *   row: 5,
 *   height: 40
 * });
 * // Row height saved to DB and broadcast to all room members
 * ```
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
 *
 * @description Updates a sheet's display name in the database and broadcasts
 * the change to all collaborators in the room. The new name is shown in the
 * sheet tabs UI.
 *
 * @param {ExtendedWebSocket} ws - The WebSocket connection that renamed the sheet
 * @param {RenameSheetPayload} payload - Contains sheetId and the new name
 * @returns {Promise<void>} Resolves when the rename has been persisted and broadcast
 *
 * @example
 * ```typescript
 * // When receiving a RENAME_SHEET message from client
 * await handleRenameSheet(ws, {
 *   sheetId: 'sheet-abc',
 *   name: 'Q4 Budget'
 * });
 * // Sheet name updated in DB and broadcast to all room members
 * ```
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
