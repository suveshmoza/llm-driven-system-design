/**
 * Cell edit operations handler.
 * Handles cell value updates with idempotency and caching.
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
 */
const pubSubBreaker = createPubSubBreaker(
  async (channel: string, message: string) => redis.publish(channel, message)
);

/**
 * Handles cell edit operations from clients.
 * Implements idempotency to prevent duplicate writes from retries.
 * Persists the change to the database and broadcasts to all room members.
 *
 * @param ws - The WebSocket connection that made the edit
 * @param payload - Contains sheetId, row, col, value, and optional requestId
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
