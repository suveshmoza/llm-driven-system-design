import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { isAuthenticated } from '../middleware/auth.js';

const router = Router();

interface ReviewBody {
  orderId: number | string;
  productId: number | string;
  rating: number | string;
  comment?: string;
  images?: string[];
}

interface ReviewUpdateBody {
  rating?: number | string;
  comment?: string;
  images?: string[];
}

interface ReviewRow {
  id: number;
  order_id: number;
  product_id: number;
  shop_id: number;
  user_id: number;
  rating: number;
  comment: string | null;
  images: string[];
  username?: string;
  avatar_url?: string | null;
  product_title?: string;
  created_at: Date;
  updated_at: Date;
}

interface OrderRow {
  id: number;
  shop_id: number;
  item_id: number;
}

interface CountRow {
  count: string;
}

interface AvgRatingRow {
  avg_rating: string | null;
  review_count?: string;
}

// Get reviews for a product
router.get('/product/:productId', async (req: Request<{ productId: string }>, res: Response) => {
  try {
    const { productId } = req.params;
    const { limit = '10', offset = '0' } = req.query as { limit?: string; offset?: string };

    const result = await db.query<ReviewRow>(
      `SELECT r.*, u.username, u.avatar_url
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [parseInt(productId), parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query<CountRow>(
      'SELECT COUNT(*) FROM reviews WHERE product_id = $1',
      [parseInt(productId)]
    );

    const avgResult = await db.query<AvgRatingRow>(
      'SELECT AVG(rating)::numeric(2,1) as avg_rating FROM reviews WHERE product_id = $1',
      [parseInt(productId)]
    );

    res.json({
      reviews: result.rows,
      total: parseInt(countResult.rows[0].count),
      averageRating: parseFloat(avgResult.rows[0].avg_rating || '0') || 0,
    });
  } catch (error) {
    console.error('Get product reviews error:', error);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

// Get reviews for a shop
router.get('/shop/:shopId', async (req: Request<{ shopId: string }>, res: Response) => {
  try {
    const { shopId } = req.params;
    const { limit = '10', offset = '0' } = req.query as { limit?: string; offset?: string };

    const result = await db.query<ReviewRow>(
      `SELECT r.*, u.username, u.avatar_url, p.title as product_title
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN products p ON r.product_id = p.id
       WHERE r.shop_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [parseInt(shopId), parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query<CountRow>(
      'SELECT COUNT(*) FROM reviews WHERE shop_id = $1',
      [parseInt(shopId)]
    );

    const avgResult = await db.query<AvgRatingRow>(
      'SELECT AVG(rating)::numeric(2,1) as avg_rating FROM reviews WHERE shop_id = $1',
      [parseInt(shopId)]
    );

    res.json({
      reviews: result.rows,
      total: parseInt(countResult.rows[0].count),
      averageRating: parseFloat(avgResult.rows[0].avg_rating || '0') || 0,
    });
  } catch (error) {
    console.error('Get shop reviews error:', error);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

// Create review (after purchase)
router.post('/', isAuthenticated, async (req: Request<object, object, ReviewBody>, res: Response) => {
  try {
    const { orderId, productId, rating, comment, images } = req.body;

    if (!orderId || !productId || !rating) {
      return res.status(400).json({ error: 'Order ID, product ID, and rating are required' });
    }

    const ratingNum = parseInt(String(rating));
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Verify order belongs to user and contains the product
    const orderResult = await db.query<OrderRow>(
      `SELECT o.*, oi.id as item_id
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1 AND o.buyer_id = $2 AND oi.product_id = $3`,
      [parseInt(String(orderId)), req.session.userId, parseInt(String(productId))]
    );

    if (orderResult.rows.length === 0) {
      return res.status(403).json({ error: 'You can only review products you have purchased' });
    }

    const order = orderResult.rows[0];

    // Check if already reviewed
    const existingReview = await db.query<{ id: number }>(
      'SELECT id FROM reviews WHERE order_id = $1 AND product_id = $2',
      [parseInt(String(orderId)), parseInt(String(productId))]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reviewed this product for this order' });
    }

    // Create review
    const result = await db.query<ReviewRow>(
      `INSERT INTO reviews (order_id, product_id, shop_id, user_id, rating, comment, images)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parseInt(String(orderId)),
        parseInt(String(productId)),
        order.shop_id,
        req.session.userId,
        ratingNum,
        comment || null,
        images || [],
      ]
    );

    // Update shop rating
    const shopRatingResult = await db.query<AvgRatingRow>(
      `SELECT AVG(rating)::numeric(2,1) as avg_rating, COUNT(*) as review_count
       FROM reviews WHERE shop_id = $1`,
      [order.shop_id]
    );

    await db.query(
      'UPDATE shops SET rating = $1, review_count = $2 WHERE id = $3',
      [
        parseFloat(shopRatingResult.rows[0].avg_rating || '0'),
        parseInt(shopRatingResult.rows[0].review_count || '0'),
        order.shop_id,
      ]
    );

    res.status(201).json({ review: result.rows[0] });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Update review
router.put('/:id', isAuthenticated, async (req: Request<{ id: string }, object, ReviewUpdateBody>, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, comment, images } = req.body;

    // Check ownership
    const reviewResult = await db.query<ReviewRow>(
      'SELECT * FROM reviews WHERE id = $1 AND user_id = $2',
      [parseInt(id), req.session.userId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const result = await db.query<ReviewRow>(
      `UPDATE reviews SET
        rating = COALESCE($1, rating),
        comment = COALESCE($2, comment),
        images = COALESCE($3, images),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        rating ? parseInt(String(rating)) : null,
        comment,
        images,
        parseInt(id),
      ]
    );

    // Update shop rating
    const shopRatingResult = await db.query<AvgRatingRow>(
      `SELECT AVG(rating)::numeric(2,1) as avg_rating FROM reviews WHERE shop_id = $1`,
      [reviewResult.rows[0].shop_id]
    );

    await db.query(
      'UPDATE shops SET rating = $1 WHERE id = $2',
      [parseFloat(shopRatingResult.rows[0].avg_rating || '0'), reviewResult.rows[0].shop_id]
    );

    res.json({ review: result.rows[0] });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// Delete review
router.delete('/:id', isAuthenticated, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;

    const reviewResult = await db.query<ReviewRow>(
      'SELECT * FROM reviews WHERE id = $1 AND user_id = $2',
      [parseInt(id), req.session.userId]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    await db.query('DELETE FROM reviews WHERE id = $1', [parseInt(id)]);

    // Update shop rating
    const shopRatingResult = await db.query<AvgRatingRow>(
      `SELECT AVG(rating)::numeric(2,1) as avg_rating, COUNT(*) as review_count
       FROM reviews WHERE shop_id = $1`,
      [reviewResult.rows[0].shop_id]
    );

    await db.query(
      'UPDATE shops SET rating = COALESCE($1, 0), review_count = $2 WHERE id = $3',
      [
        parseFloat(shopRatingResult.rows[0].avg_rating || '0') || 0,
        parseInt(shopRatingResult.rows[0].review_count || '0'),
        reviewResult.rows[0].shop_id,
      ]
    );

    res.json({ message: 'Review deleted' });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
