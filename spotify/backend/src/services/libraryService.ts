import { pool } from '../db.js';
import type { LibraryItemType } from '../types.js';

// Save item to library (like a track, album, artist, or follow a playlist)
/** Saves an item (track, album, artist, playlist) to the user's library. */
export async function saveToLibrary(userId: string, itemType: LibraryItemType, itemId: string) {
  await pool.query(
    `INSERT INTO user_library (user_id, item_type, item_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
    [userId, itemType, itemId]
  );
  return { saved: true };
}

// Remove item from library
/** Removes an item from the user's library. */
export async function removeFromLibrary(userId: string, itemType: LibraryItemType, itemId: string) {
  await pool.query(
    `DELETE FROM user_library
     WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
    [userId, itemType, itemId]
  );
  return { saved: false };
}

// Check if item is in library
/** Checks if a single item is in the user's library. */
export async function isInLibrary(userId: string, itemType: LibraryItemType, itemId: string) {
  const result = await pool.query(
    `SELECT 1 FROM user_library
     WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
    [userId, itemType, itemId]
  );
  return result.rows.length > 0;
}

// Check multiple items at once
/** Batch-checks which items from a list are saved in the user's library. */
export async function checkMultipleInLibrary(userId: string, itemType: LibraryItemType, itemIds: string[]) {
  if (!itemIds || itemIds.length === 0) return {};

  const result = await pool.query(
    `SELECT item_id FROM user_library
     WHERE user_id = $1 AND item_type = $2 AND item_id = ANY($3)`,
    [userId, itemType, itemIds]
  );

  const savedMap: Record<string, boolean> = {};
  for (const id of itemIds) {
    savedMap[id] = result.rows.some(row => row.item_id === id);
  }
  return savedMap;
}

// Get liked songs
/** Returns the user's liked songs with track details and pagination. */
export async function getLikedSongs(userId: string, { limit = 50, offset = 0 }: { limit?: number; offset?: number }) {
  const result = await pool.query(
    `SELECT t.*,
            a.title as album_title, a.cover_url as album_cover_url,
            ar.name as artist_name, ar.id as artist_id,
            ul.saved_at
     FROM user_library ul
     JOIN tracks t ON ul.item_id = t.id
     JOIN albums a ON t.album_id = a.id
     JOIN artists ar ON a.artist_id = ar.id
     WHERE ul.user_id = $1 AND ul.item_type = 'track'
     ORDER BY ul.saved_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_library
     WHERE user_id = $1 AND item_type = 'track'`,
    [userId]
  );

  return {
    tracks: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

// Get saved albums
/** Returns albums saved to the user's library with artist details and pagination. */
export async function getSavedAlbums(userId: string, { limit = 50, offset = 0 }: { limit?: number; offset?: number }) {
  const result = await pool.query(
    `SELECT a.*, ar.name as artist_name, ul.saved_at
     FROM user_library ul
     JOIN albums a ON ul.item_id = a.id
     JOIN artists ar ON a.artist_id = ar.id
     WHERE ul.user_id = $1 AND ul.item_type = 'album'
     ORDER BY ul.saved_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_library
     WHERE user_id = $1 AND item_type = 'album'`,
    [userId]
  );

  return {
    albums: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

// Get followed artists
/** Returns artists the user follows with pagination. */
export async function getFollowedArtists(userId: string, { limit = 50, offset = 0 }: { limit?: number; offset?: number }) {
  const result = await pool.query(
    `SELECT ar.*, ul.saved_at as followed_at
     FROM user_library ul
     JOIN artists ar ON ul.item_id = ar.id
     WHERE ul.user_id = $1 AND ul.item_type = 'artist'
     ORDER BY ul.saved_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_library
     WHERE user_id = $1 AND item_type = 'artist'`,
    [userId]
  );

  return {
    artists: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

// Get followed/saved playlists
/** Returns playlists saved to the user's library with owner info and track counts. */
export async function getSavedPlaylists(userId: string, { limit = 50, offset = 0 }: { limit?: number; offset?: number }) {
  const result = await pool.query(
    `SELECT p.*, u.username as owner_username, ul.saved_at
     FROM user_library ul
     JOIN playlists p ON ul.item_id = p.id
     JOIN users u ON p.owner_id = u.id
     WHERE ul.user_id = $1 AND ul.item_type = 'playlist'
     ORDER BY ul.saved_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM user_library
     WHERE user_id = $1 AND item_type = 'playlist'`,
    [userId]
  );

  return {
    playlists: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

export default {
  saveToLibrary,
  removeFromLibrary,
  isInLibrary,
  checkMultipleInLibrary,
  getLikedSongs,
  getSavedAlbums,
  getFollowedArtists,
  getSavedPlaylists,
};
