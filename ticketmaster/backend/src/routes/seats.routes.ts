/**
 * Seat routes for viewing availability and managing seat reservations.
 * Endpoints:
 * - GET /:eventId/availability - Get seat availability by section
 * - GET /:eventId/sections/:section - Get individual seats for a section
 * - POST /:eventId/reserve - Reserve selected seats
 * - POST /:eventId/release - Release reserved seats
 * - GET /reservation - Get current reservation for session
 */
import { Router, Request, Response } from 'express';
import { seatService } from '../services/seat.service.js';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';

/** Express router for seat endpoints */
const router = Router();

/**
 * GET /:eventId/availability
 * Returns seat availability grouped by section.
 * Optionally filter by section name via query parameter.
 */
router.get('/:eventId/availability', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { section } = req.query;
    const availability = await seatService.getSeatAvailability(
      req.params.eventId,
      section as string
    );

    res.json({ success: true, data: availability });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get availability';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /:eventId/sections/:section
 * Returns all individual seats for a specific section.
 * Used to render the seat map UI.
 */
router.get('/:eventId/sections/:section', async (req: Request, res: Response) => {
  try {
    const seats = await seatService.getSectionSeats(req.params.eventId, req.params.section);
    res.json({ success: true, data: seats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get section seats';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /:eventId/reserve
 * Reserves selected seats for the authenticated user's session.
 * Seats are held for 10 minutes. Maximum 10 seats per reservation.
 */
router.post('/:eventId/reserve', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { seat_ids } = req.body;

    if (!seat_ids || !Array.isArray(seat_ids) || seat_ids.length === 0) {
      res.status(400).json({ success: false, error: 'seat_ids array is required' });
      return;
    }

    if (seat_ids.length > 10) {
      res.status(400).json({ success: false, error: 'Cannot reserve more than 10 seats at once' });
      return;
    }

    const result = await seatService.reserveSeats(
      req.sessionId!,
      req.params.eventId,
      seat_ids
    );

    res.json({
      success: true,
      data: {
        seats: result.seats,
        expiresAt: result.expiresAt,
        totalPrice: result.seats.reduce((sum, s) => sum + parseFloat(String(s.price)), 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reserve seats';
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * POST /:eventId/release
 * Releases previously reserved seats back to available status.
 * Only releases seats held by the current session.
 */
router.post('/:eventId/release', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { seat_ids } = req.body;

    if (!seat_ids || !Array.isArray(seat_ids) || seat_ids.length === 0) {
      res.status(400).json({ success: false, error: 'seat_ids array is required' });
      return;
    }

    await seatService.releaseSeats(req.sessionId!, req.params.eventId, seat_ids);

    res.json({ success: true, data: { message: 'Seats released' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to release seats';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /reservation
 * Returns the current active reservation for the authenticated session.
 * Returns null data if no reservation exists.
 */
router.get('/reservation', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reservation = await seatService.getReservation(req.sessionId!);

    if (!reservation) {
      res.json({ success: true, data: null });
      return;
    }

    res.json({
      success: true,
      data: {
        event_id: reservation.event_id,
        seats: reservation.seats,
        total_price: reservation.total_price,
        expires_at: reservation.expires_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get reservation';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
