import { query } from './db.js';
import { cacheGet, cacheSet, cacheDel } from './redis.js';
import { logger } from './logger.js';

export interface PinRow {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  image_url: string;
  image_width: number | null;
  image_height: number | null;
  aspect_ratio: number | null;
  dominant_color: string | null;
  link_url: string | null;
  status: string;
  save_count: number;
  comment_count: number;
  created_at: Date;
  updated_at: Date;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
}

/**
 * Get a single pin by ID with user info.
 */
export async function getPinById(pinId: string): Promise<PinRow | null> {
  const cacheKey = `pin:${pinId}`;
  const cached = await cacheGet<PinRow>(cacheKey);
  if (cached) return cached;

  const result = await query(
    `SELECT p.*, u.username, u.display_name, u.avatar_url
     FROM pins p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [pinId],
  );

  if (result.rows.length === 0) return null;

  await cacheSet(cacheKey, result.rows[0], 120);
  return result.rows[0];
}

/**
 * Create a new pin.
 */
export async function createPin(data: {
  userId: string;
  title?: string;
  description?: string;
  imageUrl: string;
  linkUrl?: string;
}): Promise<PinRow> {
  const result = await query(
    `INSERT INTO pins (user_id, title, description, image_url, link_url, status)
     VALUES ($1, $2, $3, $4, $5, 'processing')
     RETURNING *`,
    [data.userId, data.title || null, data.description || null, data.imageUrl, data.linkUrl || null],
  );
  return result.rows[0];
}

/**
 * Update pin image processing results.
 */
export async function updatePinProcessing(
  pinId: string,
  data: {
    imageWidth: number;
    imageHeight: number;
    aspectRatio: number;
    dominantColor: string;
    status: string;
    thumbnailUrl?: string;
  },
): Promise<void> {
  const imageUrl = data.thumbnailUrl
    ? data.thumbnailUrl
    : undefined;

  if (imageUrl) {
    await query(
      `UPDATE pins SET
        image_width = $2,
        image_height = $3,
        aspect_ratio = $4,
        dominant_color = $5,
        status = $6,
        image_url = $7,
        updated_at = NOW()
       WHERE id = $1`,
      [pinId, data.imageWidth, data.imageHeight, data.aspectRatio, data.dominantColor, data.status, imageUrl],
    );
  } else {
    await query(
      `UPDATE pins SET
        image_width = $2,
        image_height = $3,
        aspect_ratio = $4,
        dominant_color = $5,
        status = $6,
        updated_at = NOW()
       WHERE id = $1`,
      [pinId, data.imageWidth, data.imageHeight, data.aspectRatio, data.dominantColor, data.status],
    );
  }

  await cacheDel(`pin:${pinId}`);
}

/**
 * Search pins by title/description.
 */
export async function searchPins(
  searchQuery: string,
  limit = 20,
  offset = 0,
): Promise<PinRow[]> {
  const result = await query(
    `SELECT p.*, u.username, u.display_name, u.avatar_url
     FROM pins p
     JOIN users u ON u.id = p.user_id
     WHERE p.status = 'published'
       AND (p.title ILIKE $1 OR p.description ILIKE $1)
     ORDER BY p.save_count DESC, p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [`%${searchQuery}%`, limit, offset],
  );
  return result.rows;
}

/**
 * Get pins by user ID.
 */
export async function getPinsByUserId(
  userId: string,
  limit = 20,
  cursor?: string,
): Promise<PinRow[]> {
  let result;
  if (cursor) {
    result = await query(
      `SELECT p.*, u.username, u.display_name, u.avatar_url
       FROM pins p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1 AND p.status = 'published' AND p.created_at < $3
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [userId, limit, cursor],
    );
  } else {
    result = await query(
      `SELECT p.*, u.username, u.display_name, u.avatar_url
       FROM pins p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1 AND p.status = 'published'
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
  }
  return result.rows;
}

/**
 * Save a pin to a board.
 */
export async function savePinToBoard(
  pinId: string,
  userId: string,
  boardId: string,
): Promise<boolean> {
  try {
    await query(
      `INSERT INTO pin_saves (pin_id, user_id, board_id) VALUES ($1, $2, $3)
       ON CONFLICT (pin_id, user_id, board_id) DO NOTHING`,
      [pinId, userId, boardId],
    );

    await query(
      `INSERT INTO board_pins (board_id, pin_id, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM board_pins WHERE board_id = $1), 0))
       ON CONFLICT (board_id, pin_id) DO NOTHING`,
      [boardId, pinId],
    );

    // Update counts
    await query(`UPDATE pins SET save_count = save_count + 1 WHERE id = $1`, [pinId]);
    await query(`UPDATE boards SET pin_count = pin_count + 1, updated_at = NOW() WHERE id = $1`, [boardId]);

    await cacheDel(`pin:${pinId}`);
    await cacheDel(`board:${boardId}`);

    return true;
  } catch (err) {
    logger.error({ err, pinId, boardId }, 'Error saving pin to board');
    return false;
  }
}

/**
 * Unsave a pin from a board.
 */
export async function unsavePinFromBoard(
  pinId: string,
  userId: string,
  boardId: string,
): Promise<boolean> {
  try {
    const result = await query(
      `DELETE FROM pin_saves WHERE pin_id = $1 AND user_id = $2 AND board_id = $3`,
      [pinId, userId, boardId],
    );

    if (result.rowCount === 0) return false;

    await query(`DELETE FROM board_pins WHERE board_id = $1 AND pin_id = $2`, [boardId, pinId]);
    await query(`UPDATE pins SET save_count = GREATEST(save_count - 1, 0) WHERE id = $1`, [pinId]);
    await query(`UPDATE boards SET pin_count = GREATEST(pin_count - 1, 0), updated_at = NOW() WHERE id = $1`, [boardId]);

    await cacheDel(`pin:${pinId}`);
    await cacheDel(`board:${boardId}`);

    return true;
  } catch (err) {
    logger.error({ err, pinId, boardId }, 'Error unsaving pin from board');
    return false;
  }
}

/**
 * Delete a pin.
 */
export async function deletePin(pinId: string, userId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM pins WHERE id = $1 AND user_id = $2`,
    [pinId, userId],
  );
  await cacheDel(`pin:${pinId}`);
  return (result.rowCount ?? 0) > 0;
}
