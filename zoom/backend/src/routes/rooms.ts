import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import * as breakoutService from '../services/breakoutService.js';

const router = Router();

// Create breakout rooms for a meeting
router.post('/:meetingId/breakout-rooms', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rooms } = req.body;
    if (!rooms || !Array.isArray(rooms)) {
      res.status(400).json({ error: 'rooms array is required' });
      return;
    }
    const result = await breakoutService.createBreakoutRooms(req.params.meetingId, rooms);
    res.status(201).json({ rooms: result });
  } catch (err) {
    logger.error({ err }, 'Create breakout rooms error');
    res.status(500).json({ error: 'Failed to create breakout rooms' });
  }
});

// Get breakout rooms for a meeting
router.get('/:meetingId/breakout-rooms', requireAuth, async (req: Request, res: Response) => {
  try {
    const rooms = await breakoutService.getBreakoutRooms(req.params.meetingId);
    res.json({ rooms });
  } catch (err) {
    logger.error({ err }, 'Get breakout rooms error');
    res.status(500).json({ error: 'Failed to get breakout rooms' });
  }
});

// Assign participant to breakout room
router.post('/breakout-rooms/:roomId/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const { participantId } = req.body;
    if (!participantId) {
      res.status(400).json({ error: 'participantId is required' });
      return;
    }
    const assignment = await breakoutService.assignParticipant(req.params.roomId, participantId);
    res.status(201).json({ assignment });
  } catch (err) {
    logger.error({ err }, 'Assign participant error');
    res.status(500).json({ error: 'Failed to assign participant' });
  }
});

// Activate breakout rooms
router.post('/:meetingId/breakout-rooms/activate', requireAuth, async (req: Request, res: Response) => {
  try {
    await breakoutService.activateBreakoutRooms(req.params.meetingId);
    res.json({ message: 'Breakout rooms activated' });
  } catch (err) {
    logger.error({ err }, 'Activate breakout rooms error');
    res.status(500).json({ error: 'Failed to activate breakout rooms' });
  }
});

// Close breakout rooms
router.post('/:meetingId/breakout-rooms/close', requireAuth, async (req: Request, res: Response) => {
  try {
    await breakoutService.closeBreakoutRooms(req.params.meetingId);
    res.json({ message: 'Breakout rooms closed' });
  } catch (err) {
    logger.error({ err }, 'Close breakout rooms error');
    res.status(500).json({ error: 'Failed to close breakout rooms' });
  }
});

// Delete breakout rooms
router.delete('/:meetingId/breakout-rooms', requireAuth, async (req: Request, res: Response) => {
  try {
    await breakoutService.deleteBreakoutRooms(req.params.meetingId);
    res.json({ message: 'Breakout rooms deleted' });
  } catch (err) {
    logger.error({ err }, 'Delete breakout rooms error');
    res.status(500).json({ error: 'Failed to delete breakout rooms' });
  }
});

export default router;
