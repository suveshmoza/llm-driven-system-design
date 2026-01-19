import { Request, Response } from 'express';
import logger from '../../services/logger.js';
import { withIdempotency } from '../../services/idempotency.js';
import { logCheckoutEvent, AuditAction, ActorType, AuditContext } from '../../services/audit.js';
import { checkoutsTotal, checkoutLatency } from '../../services/metrics.js';
import { processCheckoutInternal } from './checkout-processor.js';
import type { Address } from './types.js';

/**
 * Process checkout with idempotency, audit logging, and async notifications
 *
 * This function demonstrates several reliability patterns:
 * 1. Idempotency - prevents duplicate orders if client retries
 * 2. Audit logging - tracks all checkout events for dispute resolution
 * 3. Circuit breaker - protects against payment gateway failures
 * 4. Async queues - reliable delivery of order notifications
 * 5. Metrics - tracks checkout latency and success rates
 */
export async function checkout(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { email, shippingAddress, billingAddress } = req.body as {
    email: string;
    shippingAddress?: Address;
    billingAddress?: Address;
  };
  const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'] as string | undefined;
  const idempotencyKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;

  const checkoutStartTime = Date.now();

  const auditContext: AuditContext = {
    storeId: storeId!,
    userId: null,
    userType: ActorType.CUSTOMER,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'] as string | undefined,
  };

  if (!storeId) {
    return res.status(404).json({ error: 'Store not found' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'No cart session' });
  }

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  await logCheckoutEvent(auditContext, AuditAction.CHECKOUT_STARTED, { cartId: sessionId, email });

  try {
    if (idempotencyKey) {
      const { result, deduplicated } = await withIdempotency(
        idempotencyKey,
        storeId,
        'checkout',
        async () => processCheckoutInternal(storeId, sessionId, email, shippingAddress, billingAddress, auditContext),
        { email, cartSession: sessionId }
      );

      recordMetrics(storeId, checkoutStartTime, 'success');

      if (deduplicated) {
        logger.info({ storeId, idempotencyKey }, 'Checkout deduplicated via idempotency key');
        return res.status(200).json({ order: result, deduplicated: true });
      }

      res.clearCookie('cartSession');
      return res.status(201).json({ order: result });
    }

    const order = await processCheckoutInternal(storeId, sessionId, email, shippingAddress, billingAddress, auditContext);

    recordMetrics(storeId, checkoutStartTime, 'success');

    res.clearCookie('cartSession');
    res.status(201).json({ order });
  } catch (error) {
    recordMetrics(storeId, checkoutStartTime, 'failed');

    await logCheckoutEvent(auditContext, AuditAction.CHECKOUT_FAILED, {
      cartId: sessionId,
      error: (error as Error).message,
    });

    logger.error({ err: error, storeId, sessionId }, 'Checkout failed');
    throw error;
  }
}

function recordMetrics(storeId: number, startTime: number, status: 'success' | 'failed'): void {
  const latency = (Date.now() - startTime) / 1000;
  checkoutLatency.observe({ store_id: storeId.toString(), status }, latency);
  checkoutsTotal.inc({ store_id: storeId.toString(), status });
}
