/**
 * Server-Sent Events Handler
 *
 * Manages SSE client connections for real-time message streaming.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import type { ApiResponse, ChatMessage } from '../../types/index.js';
import { connectionManager } from '../../core/index.js';
import { httpLogger } from '../../utils/logger.js';
import type { SSEManager } from './types.js';

/**
 * SSE Handler class for managing Server-Sent Events connections
 */
export class SSEHandler {
  private sseManager: SSEManager;

  constructor(sseManager: SSEManager) {
    this.sseManager = sseManager;
  }

  /** Create Express router for SSE endpoints */
  createRouter(): Router {
    const router = express.Router();
    router.get('/messages/:room', (req, res) => this.handleSSEConnection(req, res));
    router.get('/session/:sessionId', (req, res) => this.handleGetSession(req, res));
    return router;
  }

  /** Handle SSE connection request */
  private handleSSEConnection(req: Request, res: Response): void {
    const roomName = req.params.room as string;
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId query parameter is required' } as ApiResponse);
      return;
    }

    const session = connectionManager.getSession(sessionId);
    if (!session) {
      res.status(401).json({ success: false, error: 'Invalid session' } as ApiResponse);
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial connection message
    res.write(`event: connected\ndata: ${JSON.stringify({ room: roomName })}\n\n`);

    // Store SSE client
    const clientId = `${sessionId}-${roomName}`;
    this.sseManager.clients.set(clientId, { sessionId, res, room: roomName });

    // Update session's send function to use SSE
    const originalSession = connectionManager.getSession(sessionId);
    if (originalSession) {
      originalSession.sendMessage = (msg: string) => this.sendSSEMessage(sessionId, msg);
    }

    // Send heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try { res.write(`:heartbeat\n\n`); }
      catch { clearInterval(heartbeatInterval); }
    }, 30000);

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      this.sseManager.clients.delete(clientId);
      httpLogger.debug({ sessionId, room: roomName }, 'SSE client disconnected');
    });

    httpLogger.debug({ sessionId, room: roomName }, 'SSE client connected');
  }

  /** Handle get session request */
  private handleGetSession(req: Request, res: Response): void {
    const sessionId = req.params.sessionId as string;
    const session = connectionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' } as ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        userId: session.userId,
        nickname: session.nickname,
        currentRoom: session.currentRoom,
        transport: session.transport,
      },
    } as ApiResponse);
  }

  /** Send a message to all SSE clients for a specific session */
  sendSSEMessage(sessionId: string, message: string): void {
    for (const [, client] of this.sseManager.clients) {
      if (client.sessionId === sessionId) {
        try { client.res.write(`event: message\ndata: ${message}\n\n`); }
        catch (error) { httpLogger.error({ sessionId, err: error }, 'Failed to send SSE message'); }
      }
    }
  }

  /** Broadcast a message to all SSE clients in a specific room */
  broadcastToRoom(roomName: string, message: ChatMessage): void {
    const jsonMessage = JSON.stringify(message);
    for (const [, client] of this.sseManager.clients) {
      if (client.room === roomName) {
        try { client.res.write(`event: message\ndata: ${jsonMessage}\n\n`); }
        catch (error) { httpLogger.error({ room: roomName, err: error }, 'Failed to broadcast SSE message'); }
      }
    }
  }

  /** Close all SSE connections for a specific session */
  closeSessionConnections(sessionId: string): void {
    for (const [clientId, client] of this.sseManager.clients) {
      if (client.sessionId === sessionId) {
        client.res.end();
        this.sseManager.clients.delete(clientId);
      }
    }
  }

  /** Notify all clients of impending shutdown and close connections */
  async shutdownClients(gracePeriodMs: number): Promise<void> {
    // Notify all SSE clients of impending shutdown
    for (const [, client] of this.sseManager.clients) {
      try { client.res.write(`event: shutdown\ndata: {"message": "Server shutting down"}\n\n`); }
      catch { /* Client may already be disconnected */ }
    }

    // Give clients time to disconnect gracefully
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        for (const [, client] of this.sseManager.clients) {
          try { client.res.end(); } catch { /* Ignore errors */ }
        }
        this.sseManager.clients.clear();
        resolve();
      }, Math.min(gracePeriodMs, 5000));
    });
  }
}
