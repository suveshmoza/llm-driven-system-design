/**
 * Stream Routes Module
 *
 * Express router handling HTTP endpoints for stream operations.
 * Provides REST API for stream CRUD, comments, reactions, and metrics.
 * WebSocket is preferred for real-time operations; these endpoints
 * serve as HTTP fallbacks and for initial data loading.
 *
 * @module routes/streams
 */

import { Router, Request, Response } from 'express';
import { streamService } from '../services/streamService.js';
import { commentService } from '../services/commentService.js';
import { reactionService } from '../services/reactionService.js';

/** Express router for stream-related endpoints */
const router = Router();

/**
 * GET /api/streams
 * Retrieves all streams (live and ended).
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const streams = await streamService.getAllStreams();
    res.json(streams);
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

/**
 * GET /api/streams/live
 * Retrieves only currently live streams.
 */
router.get('/live', async (_req: Request, res: Response) => {
  try {
    const streams = await streamService.getLiveStreams();
    res.json(streams);
  } catch (error) {
    console.error('Error fetching live streams:', error);
    res.status(500).json({ error: 'Failed to fetch live streams' });
  }
});

/**
 * GET /api/streams/:streamId
 * Retrieves a single stream by ID.
 */
router.get('/:streamId', async (req: Request, res: Response) => {
  try {
    const stream = await streamService.getStream(req.params.streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    res.json(stream);
  } catch (error) {
    console.error('Error fetching stream:', error);
    res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

/**
 * POST /api/streams
 * Creates a new live stream.
 * Body: { title: string, creator_id: string, description?: string, video_url?: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, creator_id, description, video_url } = req.body;
    if (!title || !creator_id) {
      return res.status(400).json({ error: 'Title and creator_id are required' });
    }
    const stream = await streamService.createStream(title, creator_id, description, video_url);
    res.status(201).json(stream);
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ error: 'Failed to create stream' });
  }
});

/**
 * POST /api/streams/:streamId/end
 * Ends a live stream by setting status to 'ended'.
 */
router.post('/:streamId/end', async (req: Request, res: Response) => {
  try {
    const stream = await streamService.endStream(req.params.streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    res.json(stream);
  } catch (error) {
    console.error('Error ending stream:', error);
    res.status(500).json({ error: 'Failed to end stream' });
  }
});

/**
 * GET /api/streams/:streamId/comments
 * Retrieves recent comments for a stream.
 * Query params: limit (default 50)
 */
router.get('/:streamId/comments', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const comments = await commentService.getRecentComments(req.params.streamId, limit);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * POST /api/streams/:streamId/comments
 * Posts a comment to a stream (HTTP fallback, prefer WebSocket).
 * Body: { user_id: string, content: string, parent_id?: string }
 */
router.post('/:streamId/comments', async (req: Request, res: Response) => {
  try {
    const { user_id, content, parent_id } = req.body;
    if (!user_id || !content) {
      return res.status(400).json({ error: 'user_id and content are required' });
    }
    const comment = await commentService.createComment(
      req.params.streamId,
      user_id,
      content,
      parent_id
    );
    res.status(201).json(comment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to post comment';
    console.error('Error posting comment:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/streams/:streamId/reactions
 * Retrieves aggregated reaction counts for a stream.
 */
router.get('/:streamId/reactions', async (req: Request, res: Response) => {
  try {
    const counts = await reactionService.getReactionCounts(req.params.streamId);
    res.json(counts);
  } catch (error) {
    console.error('Error fetching reactions:', error);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

/**
 * GET /api/streams/:streamId/metrics
 * Retrieves stream metrics (viewer count, comment count).
 */
router.get('/:streamId/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await streamService.getStreamMetrics(req.params.streamId);
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;
