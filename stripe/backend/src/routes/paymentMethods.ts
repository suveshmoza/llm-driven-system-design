import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth.js';
import { generateCardToken, isValidCardNumber } from '../utils/helpers.js';
import { getCardBrand, isCardExpired } from '../services/cardNetwork.js';

const router = Router();

// Interfaces
interface PaymentMethodRow {
  id: string;
  customer_id: string | null;
  merchant_id: string;
  type: string;
  card_token: string;
  card_last4: string;
  card_brand: string;
  card_exp_month: number;
  card_exp_year: number;
  card_bin: string;
  card_country: string | null;
  billing_details: Record<string, unknown> | null;
  created_at: Date;
}

interface PaymentMethodResponse {
  id: string;
  object: 'payment_method';
  type: string;
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    country: string | null;
  };
  customer: string | null;
  billing_details: Record<string, unknown>;
  created: number;
  livemode: boolean;
}

interface CardDetails {
  number?: string;
  exp_month?: number;
  exp_year?: number;
  cvc?: string;
}

interface CreatePaymentMethodBody {
  type?: string;
  card?: CardDetails;
  customer?: string;
  billing_details?: Record<string, unknown>;
}

// All routes require authentication
router.use(authenticateApiKey);

/**
 * Create a payment method
 * POST /v1/payment_methods
 */
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type = 'card', card, customer, billing_details } = req.body as CreatePaymentMethodBody;

    // Validate type
    if (type !== 'card') {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Only card payment methods are supported',
          param: 'type',
        },
      });
      return;
    }

    // Validate card details
    if (!card) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Card details are required',
          param: 'card',
        },
      });
      return;
    }

    const { number, exp_month, exp_year, cvc } = card;

    if (!number || !exp_month || !exp_year || !cvc) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Card number, expiration, and CVC are required',
          param: 'card',
        },
      });
      return;
    }

    // Clean card number
    const cleanNumber = number.replace(/\s/g, '');

    // Validate card number (Luhn check)
    if (!isValidCardNumber(cleanNumber)) {
      res.status(400).json({
        error: {
          type: 'card_error',
          code: 'invalid_number',
          message: 'Invalid card number',
          param: 'card[number]',
        },
      });
      return;
    }

    // Validate expiration
    if (exp_month < 1 || exp_month > 12) {
      res.status(400).json({
        error: {
          type: 'card_error',
          code: 'invalid_expiry_month',
          message: 'Invalid expiration month',
          param: 'card[exp_month]',
        },
      });
      return;
    }

    if (isCardExpired(exp_month, exp_year)) {
      res.status(400).json({
        error: {
          type: 'card_error',
          code: 'expired_card',
          message: 'Card has expired',
          param: 'card[exp_year]',
        },
      });
      return;
    }

    // Validate CVC
    if (!/^\d{3,4}$/.test(cvc)) {
      res.status(400).json({
        error: {
          type: 'card_error',
          code: 'invalid_cvc',
          message: 'Invalid CVC',
          param: 'card[cvc]',
        },
      });
      return;
    }

    // Validate customer if provided
    if (customer) {
      const customerResult = await query<{ id: string }>(`
        SELECT id FROM customers
        WHERE id = $1 AND merchant_id = $2
      `, [customer, req.merchantId]);

      if (customerResult.rows.length === 0) {
        res.status(400).json({
          error: {
            type: 'invalid_request_error',
            message: 'Customer not found',
            param: 'customer',
          },
        });
        return;
      }
    }

    const id = uuidv4();
    const cardToken = generateCardToken(cleanNumber);
    const cardBrand = getCardBrand(cleanNumber);
    const cardLast4 = cleanNumber.slice(-4);
    const cardBin = cleanNumber.slice(0, 6);

    const result = await query<PaymentMethodRow>(`
      INSERT INTO payment_methods
        (id, customer_id, merchant_id, type, card_token, card_last4, card_brand,
         card_exp_month, card_exp_year, card_bin, billing_details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      id,
      customer || null,
      req.merchantId,
      type,
      cardToken,
      cardLast4,
      cardBrand,
      exp_month,
      exp_year,
      cardBin,
      JSON.stringify(billing_details || {}),
    ]);

    res.status(201).json(formatPaymentMethod(result.rows[0]));
  } catch (error) {
    console.error('Create payment method error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to create payment method',
      },
    });
  }
});

/**
 * Get a payment method
 * GET /v1/payment_methods/:id
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await query<PaymentMethodRow>(`
      SELECT * FROM payment_methods
      WHERE id = $1 AND merchant_id = $2
    `, [req.params.id, req.merchantId]);

    if (result.rows.length === 0) {
      res.status(404).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment method not found',
        },
      });
      return;
    }

    res.json(formatPaymentMethod(result.rows[0]));
  } catch (error) {
    console.error('Get payment method error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to retrieve payment method',
      },
    });
  }
});

/**
 * List payment methods
 * GET /v1/payment_methods
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { limit = '10', offset = '0', customer, type = 'card' } = req.query as {
      limit?: string;
      offset?: string;
      customer?: string;
      type?: string;
    };

    let queryText = `
      SELECT * FROM payment_methods
      WHERE merchant_id = $1 AND type = $2
    `;
    const params: unknown[] = [req.merchantId, type];
    let paramIndex = 3;

    if (customer) {
      queryText += ` AND customer_id = $${paramIndex}`;
      params.push(customer);
      paramIndex++;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query<PaymentMethodRow>(queryText, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) FROM payment_methods
      WHERE merchant_id = $1 AND type = $2
    `;
    const countParams: unknown[] = [req.merchantId, type];

    if (customer) {
      countQuery += ` AND customer_id = $3`;
      countParams.push(customer);
    }

    const countResult = await query<{ count: string }>(countQuery, countParams);

    res.json({
      object: 'list',
      data: result.rows.map(formatPaymentMethod),
      has_more: parseInt(offset) + result.rows.length < parseInt(countResult.rows[0].count),
      total_count: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    console.error('List payment methods error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to list payment methods',
      },
    });
  }
});

/**
 * Attach payment method to customer
 * POST /v1/payment_methods/:id/attach
 */
router.post('/:id/attach', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { customer } = req.body as { customer?: string };

    if (!customer) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Customer is required',
          param: 'customer',
        },
      });
      return;
    }

    // Validate customer
    const customerResult = await query<{ id: string }>(`
      SELECT id FROM customers
      WHERE id = $1 AND merchant_id = $2
    `, [customer, req.merchantId]);

    if (customerResult.rows.length === 0) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Customer not found',
          param: 'customer',
        },
      });
      return;
    }

    // Get payment method
    const pmResult = await query<PaymentMethodRow>(`
      SELECT * FROM payment_methods
      WHERE id = $1 AND merchant_id = $2
    `, [req.params.id, req.merchantId]);

    if (pmResult.rows.length === 0) {
      res.status(404).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment method not found',
        },
      });
      return;
    }

    // Attach to customer
    const result = await query<PaymentMethodRow>(`
      UPDATE payment_methods
      SET customer_id = $2
      WHERE id = $1
      RETURNING *
    `, [req.params.id, customer]);

    res.json(formatPaymentMethod(result.rows[0]));
  } catch (error) {
    console.error('Attach payment method error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to attach payment method',
      },
    });
  }
});

/**
 * Detach payment method from customer
 * POST /v1/payment_methods/:id/detach
 */
router.post('/:id/detach', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Get payment method
    const pmResult = await query<PaymentMethodRow>(`
      SELECT * FROM payment_methods
      WHERE id = $1 AND merchant_id = $2
    `, [req.params.id, req.merchantId]);

    if (pmResult.rows.length === 0) {
      res.status(404).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment method not found',
        },
      });
      return;
    }

    // Detach from customer
    const result = await query<PaymentMethodRow>(`
      UPDATE payment_methods
      SET customer_id = NULL
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);

    res.json(formatPaymentMethod(result.rows[0]));
  } catch (error) {
    console.error('Detach payment method error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to detach payment method',
      },
    });
  }
});

/**
 * Format payment method for API response
 */
function formatPaymentMethod(row: PaymentMethodRow): PaymentMethodResponse {
  return {
    id: row.id,
    object: 'payment_method',
    type: row.type,
    card: {
      brand: row.card_brand,
      last4: row.card_last4,
      exp_month: row.card_exp_month,
      exp_year: row.card_exp_year,
      country: row.card_country,
    },
    customer: row.customer_id,
    billing_details: row.billing_details || {},
    created: Math.floor(new Date(row.created_at).getTime() / 1000),
    livemode: false,
  };
}

export default router;
