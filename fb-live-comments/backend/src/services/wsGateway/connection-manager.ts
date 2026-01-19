/**
 * Connection Manager Module
 *
 * Handles WebSocket connection lifecycle, heartbeat monitoring,
 * and connection tracking for streams.
 *
 * @module services/wsGateway/connection-manager
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { ExtendedWebSocket, getCloseReason } from './types.js';
import {
  logger,
  wsConnectionsGauge,
  wsConnectionsOpenedCounter,
  wsConnectionsClosedCounter,
  wsMessageSizeHistogram,
} from '../../shared/index.js';

const wsLogger = logger.child({ module: 'connection-manager' });

export type MessageHandler = (ws: ExtendedWebSocket, data: Buffer) => Promise<void>;
export type DisconnectHandler = (ws: ExtendedWebSocket) => void;

/**
 * Manages WebSocket connections and heartbeat monitoring.
 */
export class ConnectionManager {
  private wss: WebSocketServer;
  private connections: Map<string, Set<ExtendedWebSocket>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private messageHandler: MessageHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;

  constructor(server: unknown) {
    this.wss = new WebSocketServer({ server: server as import('http').Server });
  }

  setup(messageHandler: MessageHandler, disconnectHandler: DisconnectHandler): void {
    this.messageHandler = messageHandler;
    this.disconnectHandler = disconnectHandler;
    this.setupWebSocketHandlers();
    this.startHeartbeat();
    wsLogger.info('Connection manager initialized');
  }

  private setupWebSocketHandlers(): void {
    this.wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
      if (this.isShuttingDown) {
        ws.close(1001, 'Server is shutting down');
        return;
      }

      wsLogger.info({ remoteAddress: req.socket.remoteAddress }, 'New WebSocket connection');
      wsConnectionsOpenedCounter.inc();
      ws.isAlive = true;

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', async (data: Buffer) => {
        wsMessageSizeHistogram.labels('inbound', 'message').observe(data.length);
        if (this.messageHandler) await this.messageHandler(ws, data);
      });

      ws.on('close', (code) => {
        wsConnectionsClosedCounter.labels(getCloseReason(code)).inc();
        this.disconnectHandler?.(ws);
      });

      ws.on('error', (error) => {
        wsLogger.error({ error: error.message }, 'WebSocket error');
        wsConnectionsClosedCounter.labels('error').inc();
        this.disconnectHandler?.(ws);
      });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: ExtendedWebSocket) => {
        if (ws.isAlive === false) {
          this.disconnectHandler?.(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  getConnections(): Map<string, Set<ExtendedWebSocket>> {
    return this.connections;
  }

  addConnection(streamId: string, ws: ExtendedWebSocket): void {
    if (!this.connections.has(streamId)) {
      this.connections.set(streamId, new Set());
    }
    this.connections.get(streamId)!.add(ws);
    wsConnectionsGauge.labels(streamId).set(this.connections.get(streamId)!.size);
  }

  removeConnection(streamId: string, ws: ExtendedWebSocket): boolean {
    const connections = this.connections.get(streamId);
    if (!connections) return false;

    connections.delete(ws);
    if (connections.size === 0) {
      this.connections.delete(streamId);
      wsConnectionsGauge.labels(streamId).set(0);
      return true;
    }
    wsConnectionsGauge.labels(streamId).set(connections.size);
    return false;
  }

  getViewerCount(streamId: string): number {
    return this.connections.get(streamId)?.size || 0;
  }

  getTotalConnections(): number {
    let total = 0;
    this.connections.forEach((conns) => { total += conns.size; });
    return total;
  }

  async shutdown(timeoutMs = 10000): Promise<void> {
    wsLogger.info('Starting connection manager shutdown');
    this.isShuttingDown = true;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    const closePromises: Promise<void>[] = [];
    this.wss.clients.forEach((ws) => {
      closePromises.push(new Promise<void>((resolve) => {
        try {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { code: 'SERVER_SHUTDOWN', message: 'Server is shutting down' },
            timestamp: Date.now(),
          }));
        } catch { /* ignore */ }
        ws.close(1001, 'Server shutting down');
        const timeout = setTimeout(() => { ws.terminate(); resolve(); }, 1000);
        ws.once('close', () => { clearTimeout(timeout); resolve(); });
      }));
    });

    await Promise.race([
      Promise.all(closePromises),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => err ? reject(err) : resolve());
    });

    this.connections.clear();
    wsLogger.info('Connection manager shutdown complete');
  }
}
