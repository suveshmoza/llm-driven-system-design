/**
 * Seat service for managing seat availability, reservations, and holds.
 * Implements distributed locking using Redis to prevent double-booking.
 * This is the core service for the ticket inventory management system.
 */
import { query, withTransaction } from '../db/pool.js';
import redis from '../db/redis.js';
import type { EventSeat, SeatAvailability, SeatInfo } from '../types/index.js';

/** Duration in seconds that seats are held during checkout (10 minutes) */
const HOLD_DURATION = 600;
/** Cache TTL for availability data - kept very short for high accuracy during sales */
const AVAILABILITY_CACHE_TTL = 5;

/**
 * Service class for seat-related operations.
 * Handles seat availability queries, reservations, and hold management.
 */
export class SeatService {
  /**
   * Retrieves seat availability for an event, optionally filtered by section.
   * Groups seats by section and calculates availability statistics.
   * Results are briefly cached to handle high traffic during sales.
   *
   * @param eventId - The event to get availability for
   * @param section - Optional section name to filter by
   * @returns Array of section availability data with individual seats
   */
  async getSeatAvailability(eventId: string, section?: string): Promise<SeatAvailability[]> {
    const cacheKey = `availability:${eventId}:${section || 'all'}`;

    // Try cache first (very short TTL for availability)
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    let queryText = `
      SELECT section, row, seat_number, id, price, price_tier, status
      FROM event_seats
      WHERE event_id = $1
    `;
    const params: unknown[] = [eventId];

    if (section) {
      queryText += ' AND section = $2';
      params.push(section);
    }

    queryText += ' ORDER BY section, row, seat_number::int';

    const result = await query(queryText, params);

    // Group by section
    const sectionMap = new Map<string, SeatAvailability>();

    for (const row of result.rows) {
      const sectionName = row.section as string;
      if (!sectionMap.has(sectionName)) {
        sectionMap.set(sectionName, {
          section: sectionName,
          available: 0,
          total: 0,
          min_price: Infinity,
          max_price: 0,
          seats: [],
        });
      }

      const sectionData = sectionMap.get(sectionName)!;
      sectionData.total++;

      const price = parseFloat(row.price);
      sectionData.min_price = Math.min(sectionData.min_price, price);
      sectionData.max_price = Math.max(sectionData.max_price, price);

      if (row.status === 'available') {
        sectionData.available++;
      }

      sectionData.seats.push({
        id: row.id,
        row: row.row,
        seat_number: row.seat_number,
        price: price,
        price_tier: row.price_tier,
        status: row.status,
      });
    }

    const availability = Array.from(sectionMap.values()).map((s) => ({
      ...s,
      min_price: s.min_price === Infinity ? 0 : s.min_price,
    }));

    // Cache briefly
    await redis.setex(cacheKey, AVAILABILITY_CACHE_TTL, JSON.stringify(availability));

    return availability;
  }

  /**
   * Retrieves all seats for a specific section of an event.
   *
   * @param eventId - The event ID
   * @param section - The section name
   * @returns Array of seat information for the section
   */
  async getSectionSeats(eventId: string, section: string): Promise<SeatInfo[]> {
    const result = await query(
      `SELECT id, row, seat_number, price, price_tier, status
       FROM event_seats
       WHERE event_id = $1 AND section = $2
       ORDER BY row, seat_number::int`,
      [eventId, section]
    );

    return result.rows.map((row) => ({
      id: row.id,
      row: row.row,
      seat_number: row.seat_number,
      price: parseFloat(row.price),
      price_tier: row.price_tier,
      status: row.status,
    }));
  }

  /**
   * Reserves seats for a user's checkout session.
   * Uses a two-phase locking strategy:
   * 1. Acquire Redis locks for fast, distributed exclusion
   * 2. Update database with FOR UPDATE NOWAIT for ACID compliance
   *
   * Seats are held for HOLD_DURATION seconds before expiring.
   *
   * @param sessionId - The user's session ID (used as lock holder)
   * @param eventId - The event ID
   * @param seatIds - Array of seat IDs to reserve
   * @returns Object containing reserved seats and expiration time
   * @throws Error if any seats are unavailable
   */
  async reserveSeats(
    sessionId: string,
    eventId: string,
    seatIds: string[]
  ): Promise<{ seats: EventSeat[]; expiresAt: Date }> {
    const reservedSeats: EventSeat[] = [];
    const failedSeats: string[] = [];

    // Try to acquire Redis locks first (fast path)
    for (const seatId of seatIds) {
      const lockKey = `seat_lock:${eventId}:${seatId}`;
      const acquired = await redis.set(lockKey, sessionId, 'EX', HOLD_DURATION, 'NX');

      if (acquired) {
        reservedSeats.push({ id: seatId } as EventSeat);
      } else {
        failedSeats.push(seatId);
      }
    }

    if (failedSeats.length > 0) {
      // Release any seats we did acquire
      for (const seat of reservedSeats) {
        await this.releaseSeatLock(eventId, seat.id, sessionId);
      }
      throw new Error(`Seats not available: ${failedSeats.join(', ')}`);
    }

    // Update database
    const expiresAt = new Date(Date.now() + HOLD_DURATION * 1000);

    try {
      await withTransaction(async (client) => {
        // Lock rows for update
        const checkResult = await client.query(
          `SELECT id, status FROM event_seats
           WHERE event_id = $1 AND id = ANY($2)
           FOR UPDATE NOWAIT`,
          [eventId, seatIds]
        );

        // Verify all seats are available
        for (const row of checkResult.rows) {
          if (row.status !== 'available') {
            throw new Error(`Seat ${row.id} is not available`);
          }
        }

        // Update seats to held status
        await client.query(
          `UPDATE event_seats
           SET status = 'held',
               held_until = $1,
               held_by_session = $2,
               updated_at = NOW()
           WHERE event_id = $3 AND id = ANY($4)`,
          [expiresAt, sessionId, eventId, seatIds]
        );

        // Update available seats count
        await client.query(
          `UPDATE events
           SET available_seats = available_seats - $1,
               updated_at = NOW()
           WHERE id = $2`,
          [seatIds.length, eventId]
        );
      });

      // Get full seat details
      const seatsResult = await query(
        `SELECT * FROM event_seats WHERE id = ANY($1)`,
        [seatIds]
      );

      // Store reservation in Redis for quick lookup
      const reservation = {
        session_id: sessionId,
        event_id: eventId,
        seat_ids: seatIds,
        total_price: seatsResult.rows.reduce((sum, s) => sum + parseFloat(s.price), 0),
        expires_at: expiresAt.toISOString(),
      };
      await redis.setex(
        `reservation:${sessionId}`,
        HOLD_DURATION,
        JSON.stringify(reservation)
      );

      // Invalidate availability cache
      await this.invalidateAvailabilityCache(eventId);

      return { seats: seatsResult.rows, expiresAt };
    } catch (error) {
      // Release Redis locks on database error
      for (const seatId of seatIds) {
        await this.releaseSeatLock(eventId, seatId, sessionId);
      }
      throw error;
    }
  }

  /**
   * Releases previously reserved seats back to available status.
   * Called when user abandons checkout or explicitly clears selection.
   *
   * @param sessionId - The session that holds the seats
   * @param eventId - The event ID
   * @param seatIds - Array of seat IDs to release
   */
  async releaseSeats(sessionId: string, eventId: string, seatIds: string[]): Promise<void> {
    // Release Redis locks
    for (const seatId of seatIds) {
      await this.releaseSeatLock(eventId, seatId, sessionId);
    }

    // Update database
    await query(
      `UPDATE event_seats
       SET status = 'available',
           held_until = NULL,
           held_by_session = NULL,
           updated_at = NOW()
       WHERE event_id = $1
       AND id = ANY($2)
       AND held_by_session = $3`,
      [eventId, seatIds, sessionId]
    );

    // Update available seats count
    await query(
      `UPDATE events
       SET available_seats = (
         SELECT COUNT(*) FROM event_seats
         WHERE event_id = events.id AND status = 'available'
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [eventId]
    );

    // Delete reservation from Redis
    await redis.del(`reservation:${sessionId}`);

    // Invalidate availability cache
    await this.invalidateAvailabilityCache(eventId);
  }

  /**
   * Retrieves the current reservation for a session.
   * Returns reservation details including all held seats.
   *
   * @param sessionId - The session ID to look up
   * @returns Reservation details or null if no active reservation
   */
  async getReservation(sessionId: string): Promise<{
    event_id: string;
    seat_ids: string[];
    total_price: number;
    expires_at: Date;
    seats: EventSeat[];
  } | null> {
    const cached = await redis.get(`reservation:${sessionId}`);
    if (!cached) {
      return null;
    }

    const reservation = JSON.parse(cached);
    const seats = await query(
      'SELECT * FROM event_seats WHERE id = ANY($1)',
      [reservation.seat_ids]
    );

    return {
      event_id: reservation.event_id,
      seat_ids: reservation.seat_ids,
      total_price: reservation.total_price,
      expires_at: new Date(reservation.expires_at),
      seats: seats.rows,
    };
  }

  /**
   * Background job that releases seats with expired holds.
   * Called periodically to free up abandoned reservations.
   * Updates database and clears Redis locks.
   *
   * @returns Number of seats that were released
   */
  async cleanupExpiredHolds(): Promise<number> {
    // Find expired holds
    const expired = await query(`
      SELECT id, event_id, held_by_session
      FROM event_seats
      WHERE status = 'held'
      AND held_until < NOW()
    `);

    if (expired.rows.length === 0) {
      return 0;
    }

    const eventIds = new Set<string>();

    for (const seat of expired.rows) {
      // Release in database
      await query(
        `UPDATE event_seats
         SET status = 'available',
             held_until = NULL,
             held_by_session = NULL,
             updated_at = NOW()
         WHERE id = $1 AND status = 'held'`,
        [seat.id]
      );

      // Release Redis lock
      const lockKey = `seat_lock:${seat.event_id}:${seat.id}`;
      await redis.del(lockKey);

      eventIds.add(seat.event_id);
    }

    // Update available seats count and invalidate caches
    for (const eventId of eventIds) {
      await query(
        `UPDATE events
         SET available_seats = (
           SELECT COUNT(*) FROM event_seats
           WHERE event_id = events.id AND status = 'available'
         ),
         updated_at = NOW()
         WHERE id = $1`,
        [eventId]
      );

      await this.invalidateAvailabilityCache(eventId);
    }

    return expired.rows.length;
  }

  /**
   * Releases a Redis lock for a seat if owned by the specified session.
   * Only releases if the current lock holder matches the session ID.
   *
   * @param eventId - The event ID
   * @param seatId - The seat ID
   * @param sessionId - The session claiming ownership
   */
  private async releaseSeatLock(eventId: string, seatId: string, sessionId: string): Promise<void> {
    const lockKey = `seat_lock:${eventId}:${seatId}`;
    const currentHolder = await redis.get(lockKey);
    if (currentHolder === sessionId) {
      await redis.del(lockKey);
    }
  }

  /**
   * Invalidates all cached availability data for an event.
   * Called after seat status changes to ensure fresh data.
   *
   * @param eventId - The event ID to invalidate cache for
   */
  private async invalidateAvailabilityCache(eventId: string): Promise<void> {
    const keys = await redis.keys(`availability:${eventId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.del(`event:${eventId}`);
  }
}

/** Singleton instance of SeatService for use throughout the application */
export const seatService = new SeatService();
