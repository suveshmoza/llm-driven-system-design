/**
 * Authentication Routes
 *
 * @description Handles user authentication endpoints including connect and disconnect.
 * Provides REST API endpoints for establishing and terminating user sessions
 * in the chat system.
 * @module adapters/http/auth-routes
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ConnectRequest, ConnectResponse, ApiResponse } from '../../types/index.js';
import { connectionManager, chatHandler } from '../../core/index.js';
import * as dbOps from '../../db/index.js';
import { httpLogger } from '../../utils/logger.js';
import { recordConnection } from '../../shared/metrics.js';
import type { SSEHandler } from './sse-handler.js';

/**
 * Creates an Express router with authentication endpoints.
 *
 * @description Sets up routes for user session management:
 * - POST /connect: Authenticates a user with a nickname and creates a new session
 * - POST /disconnect: Terminates an existing user session and closes associated SSE connections
 *
 * @param {SSEHandler} sseHandler - SSE handler instance for managing real-time message connections.
 *                                   Used to close SSE connections when a user disconnects.
 * @returns {Router} Express router configured with authentication routes
 *
 * @example
 * // Mount auth routes on the API path
 * app.use('/api', createAuthRoutes(sseHandler));
 */
export function createAuthRoutes(sseHandler: SSEHandler): Router {
  const router = express.Router();

  // POST /api/connect - Authenticate user and create session
  router.post('/connect', async (req: Request, res: Response) => {
    try {
      const { nickname } = req.body as ConnectRequest;

      if (!nickname || nickname.length < 2 || nickname.length > 50) {
        res.status(400).json({
          success: false,
          error: 'Nickname must be between 2 and 50 characters',
        } as ApiResponse);
        return;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(nickname)) {
        res.status(400).json({
          success: false,
          error: 'Nickname can only contain letters, numbers, underscores, and hyphens',
        } as ApiResponse);
        return;
      }

      // Get or create user
      const user = await dbOps.getOrCreateUser(nickname);

      // Create session
      const sessionId = uuidv4();

      // HTTP sessions don't have a direct send function
      // Messages are sent via SSE
      const sendFn = (msg: string) => {
        // Will be replaced when SSE connects
      };

      connectionManager.connect(sessionId, user.id, user.nickname, 'http', sendFn);
      recordConnection('http', 1);

      const response: ConnectResponse = {
        sessionId,
        userId: user.id,
        nickname: user.nickname,
      };

      res.json({
        success: true,
        data: response,
      } as ApiResponse<ConnectResponse>);

      httpLogger.info(
        { sessionId, userId: user.id, nickname: user.nickname },
        'HTTP client connected'
      );
    } catch (error) {
      httpLogger.error({ err: error }, 'Connect error');
      res.status(500).json({
        success: false,
        error: 'Failed to connect',
      } as ApiResponse);
    }
  });

  // POST /api/disconnect - End user session
  router.post('/disconnect', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body as { sessionId: string };

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'sessionId is required',
        } as ApiResponse);
        return;
      }

      const session = connectionManager.getSession(sessionId);
      if (!session) {
        res.status(401).json({
          success: false,
          error: 'Invalid session',
        } as ApiResponse);
        return;
      }

      await chatHandler.handleDisconnect(sessionId);
      recordConnection('http', -1);

      // Close SSE connections for this session
      sseHandler.closeSessionConnections(sessionId);

      res.json({
        success: true,
        message: 'Disconnected',
      } as ApiResponse);
    } catch (error) {
      httpLogger.error({ err: error }, 'Disconnect error');
      res.status(500).json({
        success: false,
        error: 'Failed to disconnect',
      } as ApiResponse);
    }
  });

  return router;
}
