/**
 * Moderation Routes - Main Entry Point
 *
 * Handles all moderation actions with comprehensive audit logging:
 * - Ban/timeout users
 * - Delete messages
 * - Add/remove moderators
 * - Clear chat
 * - Chat filters/automod
 *
 * All actions are logged for:
 * - User appeal handling
 * - Abuse investigation
 * - Platform transparency
 */

import express, { Router } from 'express';

// Import sub-routers
import bansRouter from './bans.js';
import timeoutsRouter from './timeouts.js';
import filtersRouter from './filters.js';
import moderatorsRouter from './moderators.js';
import logsRouter from './logs.js';

const router: Router = express.Router();

// ===================
// Ban Management
// ===================
// POST /:channelId/ban - Ban a user (permanent)
// DELETE /:channelId/ban/:userId - Unban a user
// GET /:channelId/bans - Get banned users
router.use('/:channelId/ban', bansRouter);

// ===================
// Timeout Management
// ===================
// POST /:channelId/timeout - Timeout a user (temporary)
// DELETE /:channelId/timeout/:userId - Remove timeout
router.use('/:channelId/timeout', timeoutsRouter);

// ===================
// Chat Filters / Automod
// ===================
// GET /:channelId/filters - Get filter settings
// POST /:channelId/filters/slow-mode - Update slow mode
// POST /:channelId/filters/emote-only - Update emote-only mode
router.use('/:channelId/filters', filtersRouter);

// ===================
// Moderator Management
// ===================
// POST /:channelId/moderator - Add a moderator
// DELETE /:channelId/moderator/:userId - Remove a moderator
// GET /:channelId/moderators - Get moderators
router.use('/:channelId/moderator', moderatorsRouter);

// ===================
// Message Moderation & Logs
// ===================
// DELETE /:channelId/message/:messageId - Delete a message
// POST /:channelId/clear - Clear all chat messages (via logs router)
router.use('/:channelId/message', logsRouter);

// Chat clear needs special handling since it's POST /:channelId/clear
// Mount it at the channel level
router.use('/:channelId', logsRouter);

export default router;

// Re-export types for consumers
export * from './types.js';
export { checkModeratorAccess, getUsername } from './helpers.js';
