/**
 * Message and Command Routes
 *
 * Handles message sending and command execution endpoints.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import type { CommandRequest, MessageRequest, ApiResponse } from '../../types/index.js';
import { connectionManager, chatHandler } from '../../core/index.js';
import { httpLogger } from '../../utils/logger.js';
import { recordConnection, commandsExecuted } from '../../shared/metrics.js';
import { server } from '../../shared/config.js';

/**
 * Create command and message routes
 */
export function createCommandRoutes(): Router {
  const router = express.Router();

  // POST /api/command - Execute a slash command
  router.post('/command', async (req: Request, res: Response) => {
    try {
      const { sessionId, command } = req.body as CommandRequest;

      if (!sessionId || !command) {
        res.status(400).json({
          success: false,
          error: 'sessionId and command are required',
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

      const result = await chatHandler.handleInput(sessionId, command);

      // Record command metric
      const commandName = command.startsWith('/') ? command.split(' ')[0].slice(1) : 'message';
      commandsExecuted.labels({
        command: commandName,
        status: result.success ? 'success' : 'failure',
        instance: server.instanceId,
      }).inc();

      res.json({
        success: result.success,
        message: result.message,
        data: result.data,
      } as ApiResponse);

      // Handle disconnect
      if (result.data?.disconnect) {
        await chatHandler.handleDisconnect(sessionId);
        recordConnection('http', -1);
      }
    } catch (error) {
      httpLogger.error({ err: error }, 'Command error');
      res.status(500).json({
        success: false,
        error: 'Failed to execute command',
      } as ApiResponse);
    }
  });

  // POST /api/message - Send a chat message
  router.post('/message', async (req: Request, res: Response) => {
    try {
      const { sessionId, content } = req.body as MessageRequest;

      if (!sessionId || !content) {
        res.status(400).json({
          success: false,
          error: 'sessionId and content are required',
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

      if (!session.currentRoom) {
        res.status(400).json({
          success: false,
          error: 'You must join a room first',
        } as ApiResponse);
        return;
      }

      const result = await chatHandler.handleInput(sessionId, content);

      res.json({
        success: result.success,
        message: result.message,
        data: result.data,
      } as ApiResponse);
    } catch (error) {
      httpLogger.error({ err: error }, 'Message error');
      res.status(500).json({
        success: false,
        error: 'Failed to send message',
      } as ApiResponse);
    }
  });

  return router;
}
