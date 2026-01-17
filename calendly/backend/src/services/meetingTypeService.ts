import { pool, redis } from '../db/index.js';
import {
  type MeetingType,
  type CreateMeetingTypeInput,
  type UpdateMeetingTypeInput,
} from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for managing meeting types (event types).
 * Meeting types define the scheduling options hosts offer to invitees,
 * such as "30-minute intro call" or "1-hour consultation".
 * Uses Redis caching for performance optimization.
 */
export class MeetingTypeService {
  /**
   * Creates a new meeting type for a user.
   * Invalidates the user's meeting types cache after creation.
   * @param userId - The UUID of the host user creating the meeting type
   * @param input - Meeting type configuration including name, slug, duration, and buffers
   * @returns The newly created meeting type
   */
  async create(userId: string, input: CreateMeetingTypeInput): Promise<MeetingType> {
    const id = uuidv4();

    const result = await pool.query(
      `INSERT INTO meeting_types
       (id, user_id, name, slug, description, duration_minutes,
        buffer_before_minutes, buffer_after_minutes, max_bookings_per_day, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        userId,
        input.name,
        input.slug,
        input.description || null,
        input.duration_minutes,
        input.buffer_before_minutes,
        input.buffer_after_minutes,
        input.max_bookings_per_day || null,
        input.color,
      ]
    );

    // Invalidate cache
    await redis.del(`meeting_types:${userId}`);

    return result.rows[0];
  }

  /**
   * Retrieves a meeting type by its unique ID.
   * Results are cached in Redis for 1 hour.
   * @param id - The UUID of the meeting type
   * @returns The meeting type if found, null otherwise
   */
  async findById(id: string): Promise<MeetingType | null> {
    const cacheKey = `meeting_type:${id}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const result = await pool.query(
      `SELECT * FROM meeting_types WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const meetingType = result.rows[0];
    await redis.setex(cacheKey, 3600, JSON.stringify(meetingType));

    return meetingType;
  }

  /**
   * Finds a meeting type by user ID and slug combination.
   * Slugs are unique per user for creating friendly booking URLs.
   * @param userId - The UUID of the host user
   * @param slug - The URL-friendly slug identifier
   * @returns The meeting type if found, null otherwise
   */
  async findBySlug(userId: string, slug: string): Promise<MeetingType | null> {
    const result = await pool.query(
      `SELECT * FROM meeting_types WHERE user_id = $1 AND slug = $2`,
      [userId, slug]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Retrieves all meeting types for a user.
   * Results are cached in Redis for 5 minutes.
   * @param userId - The UUID of the host user
   * @param activeOnly - If true, only returns active (bookable) meeting types
   * @returns Array of meeting types sorted by creation date
   */
  async findByUserId(userId: string, activeOnly: boolean = false): Promise<MeetingType[]> {
    const cacheKey = `meeting_types:${userId}:${activeOnly}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    let query = `SELECT * FROM meeting_types WHERE user_id = $1`;
    if (activeOnly) {
      query += ` AND is_active = true`;
    }
    query += ` ORDER BY created_at ASC`;

    const result = await pool.query(query, [userId]);

    await redis.setex(cacheKey, 300, JSON.stringify(result.rows));

    return result.rows;
  }

  /**
   * Updates an existing meeting type.
   * Validates ownership and invalidates related caches after update.
   * @param id - The UUID of the meeting type to update
   * @param userId - The UUID of the user (for ownership verification)
   * @param updates - Partial update object with fields to modify
   * @returns The updated meeting type if found and owned by user, null otherwise
   */
  async update(
    id: string,
    userId: string,
    updates: UpdateMeetingTypeInput
  ): Promise<MeetingType | null> {
    const fields: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let paramIndex = 1;

    const allowedFields = [
      'name',
      'slug',
      'description',
      'duration_minutes',
      'buffer_before_minutes',
      'buffer_after_minutes',
      'max_bookings_per_day',
      'color',
      'is_active',
    ];

    for (const field of allowedFields) {
      const value = updates[field as keyof UpdateMeetingTypeInput];
      if (value !== undefined) {
        fields.push(`${field} = $${paramIndex++}`);
        values.push(value as string | number | boolean | null);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id, userId);

    const result = await pool.query(
      `UPDATE meeting_types SET ${fields.join(', ')}
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return null;
    }

    // Invalidate caches
    await redis.del(`meeting_type:${id}`);
    await redis.del(`meeting_types:${userId}:true`);
    await redis.del(`meeting_types:${userId}:false`);

    return result.rows[0];
  }

  /**
   * Permanently deletes a meeting type.
   * Validates ownership and removes all related cache entries.
   * @param id - The UUID of the meeting type to delete
   * @param userId - The UUID of the user (for ownership verification)
   * @returns true if deleted, false if not found or not owned by user
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM meeting_types WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rowCount && result.rowCount > 0) {
      await redis.del(`meeting_type:${id}`);
      await redis.del(`meeting_types:${userId}:true`);
      await redis.del(`meeting_types:${userId}:false`);
      return true;
    }

    return false;
  }

  /**
   * Retrieves a meeting type with host user information.
   * Used for public booking pages where invitees need host details.
   * Only returns active meeting types.
   * @param id - The UUID of the meeting type
   * @returns Meeting type with user_name, user_email, user_timezone, or null
   */
  async findByIdWithUser(id: string): Promise<(MeetingType & { user_name: string; user_email: string; user_timezone: string }) | null> {
    const result = await pool.query(
      `SELECT mt.*, u.name as user_name, u.email as user_email, u.time_zone as user_timezone
       FROM meeting_types mt
       JOIN users u ON mt.user_id = u.id
       WHERE mt.id = $1 AND mt.is_active = true`,
      [id]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }
}

/** Singleton instance of MeetingTypeService for application-wide use */
export const meetingTypeService = new MeetingTypeService();
