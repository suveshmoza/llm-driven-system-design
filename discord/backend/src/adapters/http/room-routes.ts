/**
 * Room Management Routes
 *
 * Handles room-related endpoints including listing rooms and message history.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import type { ApiResponse } from '../../types/index.js';
import { historyBuffer, roomManager } from '../../core/index.js';
import { httpLogger } from '../../utils/logger.js';
import {
  historyBufferHits,
  historyBufferMisses,
  activeRooms,
} from '../../shared/metrics.js';
import { server } from '../../shared/config.js';

/**
 * Create room management routes
 */
export function createRoomRoutes(): Router {
  const router = express.Router();

  // GET /api/rooms - List all available rooms
  router.get('/rooms', async (req: Request, res: Response) => {
    try {
      const rooms = await roomManager.listRooms();
      activeRooms.labels({ instance: server.instanceId }).set(rooms.length);
      res.json({
        success: true,
        data: { rooms },
      } as ApiResponse);
    } catch (error) {
      httpLogger.error({ err: error }, 'List rooms error');
      res.status(500).json({
        success: false,
        error: 'Failed to list rooms',
      } as ApiResponse);
    }
  });

  // GET /api/rooms/:room/history - Get message history for a room
  router.get('/rooms/:room/history', async (req: Request, res: Response) => {
    try {
      const roomName = req.params.room as string;
      const room = await roomManager.getRoom(roomName);

      if (!room) {
        historyBufferMisses.labels({ instance: server.instanceId }).inc();
        res.status(404).json({
          success: false,
          error: 'Room not found',
        } as ApiResponse);
        return;
      }

      const history = historyBuffer.getHistory(roomName);
      historyBufferHits.labels({ instance: server.instanceId }).inc();

      res.json({
        success: true,
        data: { messages: history },
      } as ApiResponse);
    } catch (error) {
      httpLogger.error({ err: error }, 'Get history error');
      res.status(500).json({
        success: false,
        error: 'Failed to get history',
      } as ApiResponse);
    }
  });

  return router;
}
