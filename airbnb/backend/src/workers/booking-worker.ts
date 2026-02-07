/**
 * Booking events worker - processes booking.events queue
 * Handles booking lifecycle events and triggers downstream actions.
 */
import { initQueue, startConsumer, QUEUES, closeQueue, publishEvent, EVENT_TYPES } from '../shared/queue.js';
import { createModuleLogger } from '../shared/logger.js';
import pool from '../db.js';

const log = createModuleLogger('booking-worker');

interface BookingEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  data: {
    booking: {
      id: number;
      listing_id: number;
      guest_id: number;
      check_in: string;
      check_out: string;
      total_price: number;
      nights: number;
      guests: number;
      status?: string;
    };
    listing?: {
      id: number;
      title: string;
      hostId: number;
    };
    cancelledBy?: string;
  };
}

/**
 * Process booking lifecycle events.
 */
async function processBookingEvent(event: BookingEvent): Promise<void> {
  const { eventId, eventType, data } = event;
  const { booking, listing } = data;

  log.info({ eventId, eventType, bookingId: booking.id }, 'Processing booking event');

  switch (eventType) {
    case EVENT_TYPES.BOOKING_CREATED:
      await handleBookingCreated(booking, listing);
      break;

    case EVENT_TYPES.BOOKING_CONFIRMED:
      await handleBookingConfirmed(booking);
      break;

    case EVENT_TYPES.BOOKING_CANCELLED:
      await handleBookingCancelled(booking, data.cancelledBy);
      break;

    case EVENT_TYPES.BOOKING_COMPLETED:
      await handleBookingCompleted(booking);
      break;

    default:
      log.warn({ eventType }, 'Unknown booking event type');
  }
}

async function handleBookingCreated(
  booking: BookingEvent['data']['booking'],
  listing?: BookingEvent['data']['listing']
): Promise<void> {
  log.info({ bookingId: booking.id }, 'Handling booking created');

  // Update booking analytics
  await pool.query(
    `INSERT INTO booking_analytics (booking_id, event_type, event_data, created_at)
     VALUES ($1, 'created', $2, NOW())
     ON CONFLICT DO NOTHING`,
    [booking.id, JSON.stringify({ listing_id: booking.listing_id, total_price: booking.total_price })]
  );

  // Send notification to host
  if (listing?.hostId) {
    await publishEvent('notification.host', {
      hostId: listing.hostId,
      type: 'new_booking_request',
      booking,
      listing,
    });
  }

  log.info({ bookingId: booking.id }, 'Booking created event processed');
}

async function handleBookingConfirmed(booking: BookingEvent['data']['booking']): Promise<void> {
  log.info({ bookingId: booking.id }, 'Handling booking confirmed');

  // Update analytics
  await pool.query(
    `INSERT INTO booking_analytics (booking_id, event_type, event_data, created_at)
     VALUES ($1, 'confirmed', $2, NOW())`,
    [booking.id, JSON.stringify({ confirmed_at: new Date().toISOString() })]
  );

  // Send confirmation notification to guest
  await publishEvent('notification.guest', {
    guestId: booking.guest_id,
    type: 'booking_confirmed',
    booking,
  });

  log.info({ bookingId: booking.id }, 'Booking confirmed event processed');
}

async function handleBookingCancelled(
  booking: BookingEvent['data']['booking'],
  cancelledBy?: string
): Promise<void> {
  log.info({ bookingId: booking.id, cancelledBy }, 'Handling booking cancelled');

  // Restore availability for the listing
  await pool.query(
    `DELETE FROM availability_blocks
     WHERE listing_id = $1 AND start_date = $2 AND end_date = $3 AND block_type = 'booked'`,
    [booking.listing_id, booking.check_in, booking.check_out]
  );

  // Update analytics
  await pool.query(
    `INSERT INTO booking_analytics (booking_id, event_type, event_data, created_at)
     VALUES ($1, 'cancelled', $2, NOW())`,
    [booking.id, JSON.stringify({ cancelled_by: cancelledBy, cancelled_at: new Date().toISOString() })]
  );

  log.info({ bookingId: booking.id }, 'Booking cancelled event processed');
}

async function handleBookingCompleted(booking: BookingEvent['data']['booking']): Promise<void> {
  log.info({ bookingId: booking.id }, 'Handling booking completed');

  // Update analytics
  await pool.query(
    `INSERT INTO booking_analytics (booking_id, event_type, event_data, created_at)
     VALUES ($1, 'completed', $2, NOW())`,
    [booking.id, JSON.stringify({ completed_at: new Date().toISOString() })]
  );

  // Trigger review reminder (after a delay in production)
  await publishEvent('notification.review_reminder', {
    guestId: booking.guest_id,
    booking,
  });

  log.info({ bookingId: booking.id }, 'Booking completed event processed');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  log.info('Starting booking events worker...');

  try {
    await initQueue();

    await startConsumer(QUEUES.BOOKING_EVENTS, async (event) => {
      await processBookingEvent(event as BookingEvent);
    });

    log.info('Booking events worker started, waiting for messages...');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log.info('Shutting down booking events worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Shutting down booking events worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });
  } catch (error) {
    log.error({ error }, 'Failed to start booking events worker');
    process.exit(1);
  }
}

main();
