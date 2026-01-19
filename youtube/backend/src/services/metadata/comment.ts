import { PoolClient } from 'pg';
import { query, transaction } from '../../utils/db.js';
import { cacheDelete } from '../../utils/redis.js';
import {
  CommentRow,
  CommentResponse,
  Pagination,
  CommentLikeResult,
  DatabaseError,
} from './types.js';

// Add comment
export const addComment = async (
  userId: string,
  videoId: string,
  text: string,
  parentId: string | null = null
): Promise<CommentResponse> => {
  const result = await transaction(async (client: PoolClient) => {
    const commentResult = await client.query<CommentRow>(
      `INSERT INTO comments (user_id, video_id, text, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, videoId, text, parentId]
    );

    // Update comment count
    await client.query('UPDATE videos SET comment_count = comment_count + 1 WHERE id = $1', [
      videoId,
    ]);

    const row = commentResult.rows[0];
    if (!row) {
      throw new Error('Failed to create comment');
    }
    return row;
  });

  // Get user info for response
  const userResult = await query<{ username: string; avatar_url: string }>(
    'SELECT username, avatar_url FROM users WHERE id = $1',
    [userId]
  );

  const userRow = userResult.rows[0];
  if (!userRow) {
    throw new Error('User not found');
  }

  // Invalidate video cache
  await cacheDelete(`video:${videoId}`);

  return {
    id: result.id,
    text: result.text,
    likeCount: result.like_count,
    isEdited: result.is_edited,
    createdAt: result.created_at,
    user: {
      id: userId,
      username: userRow.username,
      avatarUrl: userRow.avatar_url,
    },
    parentId: result.parent_id,
  };
};

// Get comments for video
export const getComments = async (
  videoId: string,
  page: number = 1,
  limit: number = 20,
  parentId: string | null = null
): Promise<{ comments: CommentResponse[]; pagination: Pagination }> => {
  const offset = (page - 1) * limit;

  const whereClause = parentId
    ? 'WHERE c.video_id = $1 AND c.parent_id = $2'
    : 'WHERE c.video_id = $1 AND c.parent_id IS NULL';

  const params: unknown[] = parentId ? [videoId, parentId] : [videoId];

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM comments c ${whereClause}`,
    params
  );

  const countRow = countResult.rows[0];
  const total = countRow ? parseInt(countRow.count, 10) : 0;

  params.push(limit, offset);

  const result = await query<CommentRow>(
    `SELECT c.*, u.username, u.avatar_url,
            (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as reply_count
     FROM comments c
     JOIN users u ON c.user_id = u.id
     ${whereClause}
     ORDER BY c.like_count DESC, c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    comments: result.rows.map((c) => ({
      id: c.id,
      text: c.text,
      likeCount: c.like_count,
      isEdited: c.is_edited,
      createdAt: c.created_at,
      replyCount: parseInt(c.reply_count || '0', 10),
      user: {
        id: c.user_id,
        username: c.username || '',
        avatarUrl: c.avatar_url || '',
      },
      parentId: c.parent_id,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Delete comment
export const deleteComment = async (commentId: string, userId: string): Promise<boolean> => {
  const result = await transaction(async (client: PoolClient) => {
    const comment = await client.query<{ video_id: string }>(
      'SELECT video_id FROM comments WHERE id = $1 AND user_id = $2',
      [commentId, userId]
    );

    const commentRow = comment.rows[0];
    if (!commentRow) {
      return null;
    }

    const videoId = commentRow.video_id;

    await client.query('DELETE FROM comments WHERE id = $1', [commentId]);

    await client.query('UPDATE videos SET comment_count = comment_count - 1 WHERE id = $1', [
      videoId,
    ]);

    return videoId;
  });

  if (result) {
    await cacheDelete(`video:${result}`);
  }

  return result !== null;
};

// Like comment
export const likeComment = async (
  userId: string,
  commentId: string
): Promise<CommentLikeResult> => {
  try {
    await query('INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)', [
      userId,
      commentId,
    ]);

    await query('UPDATE comments SET like_count = like_count + 1 WHERE id = $1', [commentId]);

    return { liked: true };
  } catch (error) {
    const dbError = error as DatabaseError;
    if (dbError.code === '23505') {
      // Already liked, unlike
      await query('DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2', [
        userId,
        commentId,
      ]);

      await query('UPDATE comments SET like_count = like_count - 1 WHERE id = $1', [commentId]);

      return { liked: false };
    }
    throw error;
  }
};
