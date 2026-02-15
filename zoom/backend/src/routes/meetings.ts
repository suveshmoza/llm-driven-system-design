import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import * as meetingService from '../services/meetingService.js';

const router = Router();

// Create a meeting
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.createMeeting(req.session.userId!, req.body);
    res.status(201).json({ meeting });
  } catch (err) {
    logger.error({ err }, 'Create meeting error');
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Get user's meetings
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetings = await meetingService.getUserMeetings(req.session.userId!);
    res.json({ meetings });
  } catch (err) {
    logger.error({ err }, 'Get meetings error');
    res.status(500).json({ error: 'Failed to get meetings' });
  }
});

// Get meeting by code
router.get('/code/:code', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.getMeetingByCode(req.params.code);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    res.json({ meeting });
  } catch (err) {
    logger.error({ err }, 'Get meeting by code error');
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

// Get meeting by id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.getMeetingById(req.params.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    res.json({ meeting });
  } catch (err) {
    logger.error({ err }, 'Get meeting by id error');
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

// Start a meeting
router.post('/:id/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.startMeeting(req.params.id, req.session.userId!);
    res.json({ meeting });
  } catch (err) {
    logger.error({ err }, 'Start meeting error');
    res.status(500).json({ error: 'Failed to start meeting' });
  }
});

// End a meeting
router.post('/:id/end', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.endMeeting(req.params.id, req.session.userId!);
    res.json({ meeting });
  } catch (err) {
    logger.error({ err }, 'End meeting error');
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

// Get participants
router.get('/:id/participants', requireAuth, async (req: Request, res: Response) => {
  try {
    const participants = await meetingService.getParticipants(req.params.id);
    res.json({ participants });
  } catch (err) {
    logger.error({ err }, 'Get participants error');
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

export default router;
