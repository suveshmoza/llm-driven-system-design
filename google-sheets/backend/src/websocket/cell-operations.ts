/**
 * Cell edit operations handler.
 *
 * @description Handles cell value updates with idempotency support, caching, and
 * real-time synchronization. Implements the core editing flow: validate, persist,
 * cache, broadcast, and acknowledge. Uses circuit breaker pattern for Redis pub/sub
 * to gracefully handle Redis outages.
 *
 * @module websocket/cell-operations
 */

import { pool } from '../shared/db.js';
import { redis } from '../shared/redis.js';
import { createChildLogger } from '../shared/logger.js';
import {
  cellEditsTotal,
  cellEditLatency,
  wsMessagesSent,
  errorsTotal,
  dbQueryDuration,
} from '../shared/metrics.js';
import { createPubSubBreaker, getCircuitState } from '../shared/circuitBreaker.js';
import {
  checkIdempotency,
  storeIdempotencyResult,
  generateCellIdempotencyKey,
} from '../shared/idempotency.js';
import { updateCachedCell } from '../shared/cache.js';
import { ExtendedWebSocket, CellEditPayload } from './types.js';
import { broadcastToRoom } from './connection-manager.js';
import { evaluateFormula } from './formula-handler.js';

/** Logger for cell operations */
const cellLogger = createChildLogger({ component: 'cell-operations' });

/**
 * Circuit breaker for Redis pub/sub operations.
 *
 * @description Wraps Redis publish calls with circuit breaker pattern to prevent
 * cascading failures when Redis is unavailable. Falls back to single-server mode
 * when the circuit is open.
 */
const pubSubBreaker = createPubSubBreaker(
  async (channel: string, message: string) => redis.publish(channel, message)
);

/**
 * Handles cell edit operations from clients.
 *
 * @description Processes cell value changes with the following flow:
 * 1. Check idempotency cache for duplicate requests
 * 2. Evaluate formulas in the new value
 * 3. Persist the change to PostgreSQL
 * 4. Update the Redis cache
 * 5. Broadcast to room members
 * 6. Publish to Redis for multi-server sync
 * 7. Store idempotency result and send acknowledgment
 *
 * @param {ExtendedWebSocket} ws - The WebSocket connection that made the edit
 * @param {CellEditPayload} payload - Contains sheetId, row, col, value, and optional requestId
 * @returns {Promise<void>} Resolves when the edit has been fully processed
 *
 * @example
 * ```typescript
 * // When receiving a CELL_EDIT message from client
 * await handleCellEdit(ws, {
 *   sheetId: 'sheet-abc',
 *   row: 5,
 *   col: 2,
 *   value: '=SUM(A1:A5)',
 *   requestId: 'req-123'
 * });
 * // Cell saved, cached, broadcast, and ACK sent to client
 * ```
 */
export async function handleCellEdit(
  ws: ExtendedWebSocket,
  payload: CellEditPayload
): Promise<void> {
  const start = Date.now();
  const { sheetId, row, col, value, requestId } = payload;

  // Check idempotency if requestId is provided
  if (requestId && ws.spreadsheetId) {
    const cachedResult = await checkForReplay(ws.spreadsheetId, sheetId, row, col, requestId);
    if (cachedResult) {
      ws.send(JSON.stringify({ type: 'CELL_EDIT_ACK', requestId, ...cachedResult }));
      return;
    }
  }

  try {
    // Compute value (in production, use HyperFormula)
    const computedValue = evaluateFormula(value);

    // Persist to database
    await persistCellEdit(sheetId, row, col, value, computedValue);

    // Update cache
    await updateCachedCell(sheetId, row, col, { rawValue: value, computedValue });

    // Record metrics
    cellEditsTotal.inc();
    cellEditLatency.observe(Date.now() - start);

    const updateMessage = {
      type: 'CELL_UPDATED',
      sheetId,
      row,
      col,
      rawValue: value,
      computedValue,
      userId: ws.userId,
    };

    // Broadcast to room
    const sentCount = broadcastToRoom(ws.spreadsheetId!, updateMessage);
    if (sentCount > 0) {
      wsMessagesSent.labels('CELL_UPDATED').inc(sentCount);
    }

    // Publish to Redis for multi-server support
    await publishCellUpdate(ws.spreadsheetId!, updateMessage);

    // Store idempotency result
    if (requestId && ws.spreadsheetId) {
      await storeIdempotencyResult(
        generateCellIdempotencyKey(ws.spreadsheetId, sheetId, row, col, requestId),
        'cell_edit',
        { sheetId, row, col, rawValue: value, computedValue }
      );
    }

    // Send acknowledgment
    ws.send(JSON.stringify({
      type: 'CELL_EDIT_ACK',
      requestId,
      sheetId,
      row,
      col,
      rawValue: value,
      computedValue,
    }));

    cellLogger.debug({ sheetId, row, col, duration: Date.now() - start, userId: ws.userId }, 'Cell edit processed');
  } catch (error) {
    errorsTotal.labels('cell_edit', 'websocket').inc();
    cellLogger.error({ error, sheetId, row, col }, 'Error handling cell edit');
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to save cell', requestId }));
  }
}

/**
 * Checks for a replay of a previous cell edit operation.
 *
 * @description Looks up the idempotency cache to determine if this request
 * has already been processed. Used to handle client retries without
 * duplicating the edit.
 *
 * @param {string} spreadsheetId - The spreadsheet containing the cell
 * @param {string} sheetId - The sheet containing the cell
 * @param {number} row - The row index of the cell
 * @param {number} col - The column index of the cell
 * @param {string} requestId - The client-provided request identifier
 * @returns {Promise<any | null>} The cached result if found, null otherwise
 */
async function checkForReplay(
  spreadsheetId: string,
  sheetId: string,
  row: number,
  col: number,
  requestId: string
): Promise<any | null> {
  const idempotencyKey = generateCellIdempotencyKey(spreadsheetId, sheetId, row, col, requestId);
  const check = await checkIdempotency<any>(idempotencyKey);

  if (check.isReplay && check.cachedResult) {
    cellLogger.debug({ sheetId, row, col, requestId }, 'Cell edit replayed from cache');
    return check.cachedResult;
  }

  return null;
}

/**
 * Persists a cell edit to the database.
 *
 * @description Performs an upsert operation to save the cell's raw and computed
 * values to PostgreSQL. Uses ON CONFLICT to handle both insert and update cases.
 * Records database query duration for monitoring.
 *
 * @param {string} sheetId - The sheet containing the cell
 * @param {number} row - The row index of the cell
 * @param {number} col - The column index of the cell
 * @param {string} value - The raw value entered by the user
 * @param {string} computedValue - The computed result after formula evaluation
 * @returns {Promise<void>} Resolves when the database write completes
 */
async function persistCellEdit(
  sheetId: string,
  row: number,
  col: number,
  value: string,
  computedValue: string
): Promise<void> {
  const dbStart = Date.now();
  await pool.query(`
    INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (sheet_id, row_index, col_index)
    DO UPDATE SET raw_value = $4, computed_value = $5, updated_at = NOW()
  `, [sheetId, row, col, value, computedValue]);
  dbQueryDuration.labels('upsert_cell').observe(Date.now() - dbStart);
}

/**
 * Publishes a cell update to Redis for multi-server sync.
 *
 * @description Publishes the cell update message to a Redis pub/sub channel
 * so that other server instances can broadcast to their local WebSocket clients.
 * Uses circuit breaker to gracefully degrade when Redis is unavailable.
 *
 * @param {string} spreadsheetId - The spreadsheet being edited
 * @param {any} message - The update message to publish
 * @returns {Promise<void>} Resolves when publish completes or circuit is open
 */
async function publishCellUpdate(spreadsheetId: string, message: any): Promise<void> {
  const pubSubState = getCircuitState(pubSubBreaker);

  if (pubSubState === 'closed' || pubSubState === 'half-open') {
    try {
      await pubSubBreaker.fire(`spreadsheet:${spreadsheetId}`, JSON.stringify(message));
    } catch (e) {
      cellLogger.warn(
        { error: e, spreadsheetId, circuitState: pubSubState },
        'Pub/sub failed, operating in single-server mode'
      );
    }
  }
}
