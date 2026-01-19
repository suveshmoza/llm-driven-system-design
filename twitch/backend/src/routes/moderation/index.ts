/**
 * Moderation Routes - Main Entry Point
 *
 * Handles all moderation actions with comprehensive audit logging:
 * - Ban/timeout users (permanent and temporary)
 * - Delete individual messages or clear entire chat
 * - Add/remove channel moderators
 * - Configure chat filters (slow mode, emote-only)
 *
 * All moderation actions are logged for:
 * - User appeal handling and transparency
 * - Abuse investigation and pattern detection
 * - Platform-wide moderation analytics
 *
 * @module routes/moderation
 *
 * @example
 * // Mount in Express app
 * import moderationRouter from './routes/moderation/index.js';
 * app.use('/api/moderation', moderationRouter);
 */

import express, { Router } from 'express';

// Import sub-routers
import bansRouter from './bans.js';
import timeoutsRouter from './timeouts.js';
import filtersRouter from './filters.js';
import moderatorsRouter from './moderators.js';
import logsRouter from './logs.js';

const router: Router = express.Router();

/**
 * Ban Management Routes
 *
 * @description POST /:channelId/ban - Ban a user (permanent or timed)
 * @description DELETE /:channelId/ban/:userId - Unban a user
 * @description GET /:channelId/bans - Get list of banned users
 */
router.use('/:channelId/ban', bansRouter);

/**
 * Timeout Management Routes
 *
 * @description POST /:channelId/timeout - Timeout a user (temporary)
 * @description DELETE /:channelId/timeout/:userId - Remove timeout early
 */
router.use('/:channelId/timeout', timeoutsRouter);

/**
 * Chat Filter Routes
 *
 * @description GET /:channelId/filters - Get filter settings
 * @description POST /:channelId/filters/slow-mode - Update slow mode
 * @description POST /:channelId/filters/emote-only - Update emote-only mode
 */
router.use('/:channelId/filters', filtersRouter);

/**
 * Moderator Management Routes
 *
 * @description POST /:channelId/moderator - Add a moderator
 * @description DELETE /:channelId/moderator/:userId - Remove a moderator
 * @description GET /:channelId/moderators - Get list of moderators
 */
router.use('/:channelId/moderator', moderatorsRouter);

/**
 * Message Moderation Routes
 *
 * @description DELETE /:channelId/message/:messageId - Delete a message
 */
router.use('/:channelId/message', logsRouter);

/**
 * Chat Clear Route
 *
 * Mounted at channel level for POST /:channelId/clear
 * @description POST /:channelId/clear - Clear all chat messages
 */
router.use('/:channelId', logsRouter);

export default router;

/**
 * Re-export types for consumers of the moderation module.
 *
 * @example
 * import { ChannelParams, BanBody } from './routes/moderation/index.js';
 */
export * from './types.js';

/**
 * Re-export helper functions for use in other modules.
 *
 * @example
 * import { checkModeratorAccess, getUsername } from './routes/moderation/index.js';
 */
export { checkModeratorAccess, getUsername } from './helpers.js';
