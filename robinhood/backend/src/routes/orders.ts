import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { orderService, PlaceOrderRequest } from '../services/orderService.js';

/**
 * Express router for order management endpoints.
 * All routes require authentication.
 * Handles order placement, retrieval, and cancellation.
 */
const router = Router();

// All order routes require authentication
router.use(authMiddleware);

/**
 * POST /api/orders
 * Places a new buy or sell order.
 * Supports market, limit, stop, and stop-limit order types.
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orderRequest: PlaceOrderRequest = {
      symbol: req.body.symbol,
      side: req.body.side,
      order_type: req.body.orderType || req.body.order_type || 'market',
      quantity: parseFloat(req.body.quantity),
      limit_price: req.body.limitPrice ? parseFloat(req.body.limitPrice) : undefined,
      stop_price: req.body.stopPrice ? parseFloat(req.body.stopPrice) : undefined,
      time_in_force: req.body.timeInForce || 'day',
    };

    const result = await orderService.placeOrder(userId, orderRequest);
    res.status(201).json(result);
  } catch (error) {
    console.error('Order placement error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/orders
 * Returns all orders for the authenticated user.
 * Optionally filter by status with ?status=filled|pending|cancelled
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = req.query.status as string | undefined;
    const orders = await orderService.getOrders(userId, status);
    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/:orderId
 * Returns details for a specific order.
 */
router.get('/:orderId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const order = await orderService.getOrder(userId, req.params.orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/orders/:orderId/executions
 * Returns all trade executions for an order.
 * An order may have multiple executions for partial fills.
 */
router.get('/:orderId/executions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const order = await orderService.getOrder(userId, req.params.orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const executions = await orderService.getExecutions(order.id);
    res.json(executions);
  } catch (error) {
    console.error('Get executions error:', error);
    res.status(500).json({ error: 'Failed to fetch executions' });
  }
});

/**
 * DELETE /api/orders/:orderId
 * Cancels a pending or partially filled order.
 * Returns error if order is already filled, cancelled, or expired.
 */
router.delete('/:orderId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const order = await orderService.cancelOrder(userId, req.params.orderId);
    res.json({ message: 'Order cancelled', order });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
