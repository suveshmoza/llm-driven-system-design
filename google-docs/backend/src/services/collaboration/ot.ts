/**
 * Operational Transformation (OT) sync logic for collaborative editing.
 * Handles transforming operations and broadcasting to clients.
 */

import type { WebSocket } from 'ws';
import type { ClientConnection } from './types.js';
import type { WSMessage } from '../../types/index.js';
import { transformOperations } from '../ot.js';
import logger, { createChildLogger } from '../../shared/logger.js';
import {
  syncLatencyHistogram,
  operationsCounter,
  conflictsCounter,
} from '../../shared/metrics.js';
import { isCircuitOpen } from '../../shared/circuitBreaker.js';
import {
  getIdempotencyResult,
  setIdempotencyResult,
  generateOperationKey,
} from '../../shared/idempotency.js';
import { documents, serverId, broadcastToDocument } from './state.js';
import { debouncedPersist, redisPublishCircuitBreaker } from './persist.js';

/**
 * Handles an edit operation from a client.
 * Transforms the operation against any concurrent operations (OT).
 * Uses idempotency keys to prevent duplicate operations on retry.
 * Broadcasts to other clients and persists to database.
 */
export async function handleOperation(
  ws: WebSocket,
  client: ClientConnection,
  msg: WSMessage
): Promise<void> {
  const startTime = Date.now();
  const documentId = client.documentId;
  if (!documentId || !msg.operation) return;

  const docState = documents.get(documentId);
  if (!docState) return;

  const opLogger = createChildLogger({
    userId: client.user.id,
    documentId,
    action: 'operation',
  });

  // Check idempotency if operation ID provided
  const operationId = (msg.data as { operationId?: string })?.operationId;
  if (operationId) {
    const idempotencyKey = generateOperationKey(client.user.id, documentId, operationId);
    const cachedResult = await getIdempotencyResult(idempotencyKey);

    if (cachedResult) {
      opLogger.debug({ operationId }, 'Duplicate operation detected (idempotency hit)');
      ws.send(JSON.stringify(cachedResult.result));
      return;
    }
  }

  const clientVersion = msg.version || 0;

  // Transform operation against any operations the client hasn't seen
  let transformedOps = msg.operation;
  let hadConflicts = false;

  if (clientVersion < docState.version) {
    const missedOps = docState.operationLog.slice(clientVersion);
    for (const serverOps of missedOps) {
      transformedOps = transformOperations(transformedOps, serverOps);
    }
    hadConflicts = true;
    conflictsCounter.inc();
    opLogger.debug({
      clientVersion,
      serverVersion: docState.version,
      missedOps: missedOps.length,
    }, 'OT conflict resolved');
  }

  // Increment version and store operation
  docState.version++;
  docState.operationLog.push(transformedOps);

  // Track operation types for metrics
  for (const op of transformedOps) {
    operationsCounter.inc({ operation_type: op.type });
  }

  // Limit operation log size (keep last 1000 operations)
  if (docState.operationLog.length > 1000) {
    docState.operationLog = docState.operationLog.slice(-500);
  }

  // Prepare and send ACK
  const ackMessage = { type: 'ACK', version: docState.version };
  ws.send(JSON.stringify(ackMessage));

  // Store idempotency result if key provided
  if (operationId) {
    const idempotencyKey = generateOperationKey(client.user.id, documentId, operationId);
    await setIdempotencyResult(idempotencyKey, ackMessage);
  }

  // Record sync latency
  const latencyMs = Date.now() - startTime;
  syncLatencyHistogram.observe({ operation_type: transformedOps[0]?.type || 'unknown' }, latencyMs);

  opLogger.debug({
    version: docState.version,
    latencyMs,
    hadConflicts,
    operationCount: transformedOps.length,
  }, 'Operation processed');

  // Broadcast to other clients in document
  broadcastToDocument(documentId, {
    type: 'OPERATION',
    version: docState.version,
    operation: transformedOps,
    data: { userId: client.user.id, userName: client.user.name },
  }, ws);

  // Publish to Redis for other servers
  try {
    await redisPublishCircuitBreaker.fire('doc:operations', JSON.stringify({
      serverId,
      docId: documentId,
      version: docState.version,
      operation: transformedOps,
      userId: client.user.id,
      userName: client.user.name,
    }));
  } catch (error) {
    if (isCircuitOpen(error)) {
      opLogger.warn('Redis publish circuit open, operation not broadcast to other servers');
    } else {
      opLogger.error({ error }, 'Failed to publish operation to Redis');
    }
  }

  // Persist operation (debounced with circuit breaker)
  debouncedPersist(documentId, docState.version, transformedOps, client.user.id);
}
