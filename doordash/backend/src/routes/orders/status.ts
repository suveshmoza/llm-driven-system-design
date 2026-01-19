import { Router, Request, Response } from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { calculateETA, ETAResult } from '../../utils/geo.js';
import { broadcastToChannels } from '../../websocket.js';
import logger from '../../shared/logger.js';
import {
  ordersActive,
  orderStatusTransitions,
  deliveryDuration,
  etaAccuracy,
} from '../../shared/metrics.js';
import { auditOrderStatusChange, ACTOR_TYPES, ActorType } from '../../shared/audit.js';
import { publishOrderEvent } from '../../shared/kafka.js';
import { ORDER_TRANSITIONS } from './types.js';
import { getOrderWithDetails } from './helpers.js';
import { matchDriverToOrder } from './driver-matching.js';

const router = Router();

// Update order status
router.patch('/:id/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, cancelReason } = req.body;

    const order = await getOrderWithDetails(parseInt(id));
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const previousStatus = order.status;

    // Validate transition
    const currentTransition = ORDER_TRANSITIONS[order.status];
    if (!currentTransition.next.includes(status)) {
      res.status(400).json({
        error: `Cannot transition from ${order.status} to ${status}`,
      });
      return;
    }

    // Check authorization based on actor
    const isCustomer = order.customer_id === req.user!.id;
    const isRestaurantOwner = order.restaurant?.owner_id === req.user!.id;
    const isDriver = order.driver?.user_id === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    let actorType: ActorType = ACTOR_TYPES.SYSTEM;

    // Special case: customer can cancel only in PLACED status
    if (status === 'CANCELLED') {
      if (order.status === 'PLACED' && isCustomer) {
        actorType = ACTOR_TYPES.CUSTOMER;
      } else if (isRestaurantOwner || isAdmin) {
        actorType = isRestaurantOwner ? ACTOR_TYPES.RESTAURANT : ACTOR_TYPES.ADMIN;
      } else {
        res.status(403).json({ error: 'Not authorized to cancel this order' });
        return;
      }
    } else {
      // Check actor
      if (currentTransition.actor === 'restaurant' && !isRestaurantOwner && !isAdmin) {
        res.status(403).json({ error: 'Only restaurant can update this status' });
        return;
      }
      if (currentTransition.actor === 'driver' && !isDriver && !isAdmin) {
        res.status(403).json({ error: 'Only driver can update this status' });
        return;
      }
      actorType = isRestaurantOwner
        ? ACTOR_TYPES.RESTAURANT
        : isDriver
          ? ACTOR_TYPES.DRIVER
          : ACTOR_TYPES.ADMIN;
    }

    // Update status
    const updateFields = [`status = $2`, `updated_at = NOW()`];
    const params: unknown[] = [id, status];

    // Set timestamp based on status
    const timestampFields: Record<string, string> = {
      CONFIRMED: 'confirmed_at',
      PREPARING: 'preparing_at',
      READY_FOR_PICKUP: 'ready_at',
      PICKED_UP: 'picked_up_at',
      DELIVERED: 'delivered_at',
      CANCELLED: 'cancelled_at',
    };

    if (timestampFields[status]) {
      updateFields.push(`${timestampFields[status]} = NOW()`);
    }

    if (status === 'CANCELLED' && cancelReason) {
      params.push(cancelReason);
      updateFields.push(`cancel_reason = $${params.length}`);
    }

    await query(`UPDATE orders SET ${updateFields.join(', ')} WHERE id = $1`, params);

    // Update metrics
    orderStatusTransitions.inc({ from_status: previousStatus, to_status: status });
    ordersActive.dec({ status: previousStatus });
    if (!['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      ordersActive.inc({ status });
    }

    // If delivered, record delivery time metrics
    if (status === 'DELIVERED' && order.placed_at) {
      const deliveryTimeMinutes = (Date.now() - new Date(order.placed_at).getTime()) / 60000;
      deliveryDuration.observe(deliveryTimeMinutes);

      // Calculate ETA accuracy if we had an estimate
      if (order.estimated_delivery_at) {
        const estimatedTime = new Date(order.estimated_delivery_at).getTime();
        const actualTime = Date.now();
        const diffMinutes = (actualTime - estimatedTime) / 60000;
        etaAccuracy.observe(diffMinutes);
      }
    }

    // If confirmed, start driver matching
    if (status === 'CONFIRMED') {
      await matchDriverToOrder(parseInt(id));
    }

    // Create audit log
    await auditOrderStatusChange(
      order,
      previousStatus,
      status,
      { type: actorType, id: req.user!.id },
      {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        cancelReason: status === 'CANCELLED' ? cancelReason : undefined,
      }
    );

    logger.info(
      {
        orderId: id,
        fromStatus: previousStatus,
        toStatus: status,
        actorType,
        actorId: req.user!.id,
      },
      'Order status updated'
    );

    // Publish order status event to Kafka
    publishOrderEvent(id.toString(), status.toLowerCase(), {
      previousStatus,
      actorType,
      actorId: req.user!.id,
      cancelReason: status === 'CANCELLED' ? cancelReason : undefined,
    });

    // Get updated order
    const updatedOrder = await getOrderWithDetails(parseInt(id));

    // Calculate ETA if driver assigned
    let eta: ETAResult | null = null;
    if (updatedOrder?.driver && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      eta = calculateETA(
        {
          status: updatedOrder.status,
          preparing_at: updatedOrder.preparing_at,
          confirmed_at: updatedOrder.confirmed_at,
          placed_at: updatedOrder.placed_at,
          delivery_address: updatedOrder.delivery_address,
        },
        {
          current_lat: updatedOrder.driver.current_lat!,
          current_lon: updatedOrder.driver.current_lon!,
          vehicle_type: updatedOrder.driver.vehicle_type as 'car' | 'bike' | 'scooter' | 'walk' | undefined,
        },
        {
          lat: updatedOrder.restaurant!.lat,
          lon: updatedOrder.restaurant!.lon,
          prep_time_minutes: updatedOrder.restaurant!.prep_time_minutes,
        }
      );
      await query('UPDATE orders SET estimated_delivery_at = $1 WHERE id = $2', [eta.eta, id]);
      updatedOrder.estimated_delivery_at = eta.eta.toISOString();
      updatedOrder.eta_breakdown = eta.breakdown;
    }

    // Broadcast to all relevant parties
    broadcastToChannels(
      [`order:${id}`, `customer:${order.customer_id}:orders`, `restaurant:${order.restaurant_id}:orders`],
      {
        type: 'order_status_update',
        order: updatedOrder,
        eta,
      }
    );

    res.json({ order: updatedOrder, eta });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, orderId: req.params.id }, 'Update order status error');
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

export default router;
