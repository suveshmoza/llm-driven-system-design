/**
 * Notification handling for booking-related events.
 * Publishes to RabbitMQ for async processing and sends direct email notifications.
 */

import { type Booking } from './types.js';
import { emailService } from '../emailService.js';
import { logger } from '../../shared/logger.js';
import { emailNotificationsTotal } from '../../shared/metrics.js';
import { queueService } from '../../shared/queue.js';

/**
 * Publishes booking confirmation notification to RabbitMQ.
 * @param booking - The newly created booking
 * @param meetingType - Meeting type details including host info
 */
export async function publishBookingConfirmation(
  booking: Booking,
  meetingType: { name: string; user_name: string; user_email: string; id: string }
): Promise<void> {
  try {
    await queueService.publishNotification('booking_confirmed', {
      bookingId: booking.id,
      hostUserId: booking.host_user_id,
      inviteeEmail: booking.invitee_email,
      inviteeName: booking.invitee_name,
      meetingTypeName: meetingType.name,
      meetingTypeId: meetingType.id,
      hostName: meetingType.user_name,
      hostEmail: meetingType.user_email,
      startTime: booking.start_time.toString(),
      endTime: booking.end_time.toString(),
      inviteeTimezone: booking.invitee_timezone,
      notes: booking.notes || undefined,
    });
  } catch (error) {
    logger.error({ error, bookingId: booking.id }, 'Failed to publish booking confirmation');
    throw error;
  }
}

/**
 * Schedules reminder notifications for a booking.
 * Schedules reminders for 24 hours and 1 hour before the meeting.
 * @param booking - The booking to schedule reminders for
 */
export async function scheduleReminders(booking: Booking): Promise<void> {
  const startTime = new Date(booking.start_time);
  const now = new Date();

  // Schedule 24-hour reminder
  const reminder24h = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
  if (reminder24h > now) {
    await queueService.scheduleReminder(booking.id, reminder24h.toISOString(), {
      hoursUntil: 24,
      inviteeEmail: booking.invitee_email,
      inviteeName: booking.invitee_name,
      startTime: booking.start_time.toString(),
      inviteeTimezone: booking.invitee_timezone,
    });
  }

  // Schedule 1-hour reminder
  const reminder1h = new Date(startTime.getTime() - 60 * 60 * 1000);
  if (reminder1h > now) {
    await queueService.scheduleReminder(booking.id, reminder1h.toISOString(), {
      hoursUntil: 1,
      inviteeEmail: booking.invitee_email,
      inviteeName: booking.invitee_name,
      startTime: booking.start_time.toString(),
      inviteeTimezone: booking.invitee_timezone,
    });
  }
}

/**
 * Publishes reschedule notification to RabbitMQ.
 * @param booking - The rescheduled booking
 * @param meetingDetails - Meeting type and host details
 */
export async function publishRescheduleNotification(
  booking: Booking,
  meetingDetails: {
    meeting_type_name: string;
    meeting_type_id: string;
    host_name: string;
    host_email: string;
  }
): Promise<void> {
  await queueService.publishNotification('booking_rescheduled', {
    bookingId: booking.id,
    hostUserId: booking.host_user_id,
    inviteeEmail: booking.invitee_email,
    inviteeName: booking.invitee_name,
    meetingTypeName: meetingDetails.meeting_type_name,
    meetingTypeId: meetingDetails.meeting_type_id,
    hostName: meetingDetails.host_name,
    hostEmail: meetingDetails.host_email,
    startTime: booking.start_time.toString(),
    endTime: booking.end_time.toString(),
    inviteeTimezone: booking.invitee_timezone,
  });
}

/**
 * Publishes cancellation notification to RabbitMQ.
 * @param booking - The cancelled booking
 * @param meetingDetails - Meeting type and host details
 * @param reason - Optional cancellation reason
 */
export async function publishCancellationNotification(
  booking: Booking,
  meetingDetails: {
    meeting_type_name: string;
    meeting_type_id: string;
    host_name: string;
    host_email: string;
  },
  reason?: string
): Promise<void> {
  await queueService.publishNotification('booking_cancelled', {
    bookingId: booking.id,
    hostUserId: booking.host_user_id,
    inviteeEmail: booking.invitee_email,
    inviteeName: booking.invitee_name,
    meetingTypeName: meetingDetails.meeting_type_name,
    meetingTypeId: meetingDetails.meeting_type_id,
    hostName: meetingDetails.host_name,
    hostEmail: meetingDetails.host_email,
    startTime: booking.start_time.toString(),
    endTime: booking.end_time.toString(),
    inviteeTimezone: booking.invitee_timezone,
    cancellationReason: reason,
  });
}

/**
 * Sends confirmation emails to both invitee and host.
 * Called asynchronously after booking creation.
 * @param booking - The newly created booking
 * @param meetingType - Meeting type details for email content
 */
export async function sendConfirmationEmails(
  booking: Booking,
  meetingType: { name: string; user_name: string; user_email: string }
): Promise<void> {
  // Send to invitee
  await emailService.sendBookingConfirmation(booking, meetingType, 'invitee');
  emailNotificationsTotal.inc({ type: 'confirmation', status: 'success' });

  // Send to host
  await emailService.sendBookingConfirmation(booking, meetingType, 'host');
  emailNotificationsTotal.inc({ type: 'confirmation', status: 'success' });
}

/**
 * Sends reschedule notification email.
 * @param booking - The rescheduled booking
 */
export async function sendRescheduleEmail(booking: Booking): Promise<void> {
  await emailService.sendRescheduleNotification(booking);
}

/**
 * Sends cancellation notification email.
 * @param booking - The cancelled booking
 * @param reason - Optional cancellation reason
 */
export async function sendCancellationEmail(
  booking: Booking,
  reason?: string
): Promise<void> {
  await emailService.sendCancellationNotification(booking, reason);
}
