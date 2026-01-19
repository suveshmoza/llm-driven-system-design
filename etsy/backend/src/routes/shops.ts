import { Router, Request, Response } from 'express';
import db from '../db/index.js';
import { isAuthenticated } from '../middleware/auth.js';

// Shared modules
import {
  getCachedShop,
  invalidateShopCache,
  cacheAside,
  CACHE_KEYS,
  CACHE_TTL,
} from '../shared/cache.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('shops');

const router = Router();

interface ShopRow {
  id: number;
  owner_id: number;
  name: string;
  slug: string;
  description: string | null;
  location: string | null;
  banner_image: string | null;
  logo_image: string | null;
  rating: number;
  review_count: number;
  sales_count: number;
  is_active: boolean;
  shipping_policy: object | null;
  return_policy: string | null;
  created_at: Date;
  updated_at: Date;
  owner_username?: string;
  owner_name?: string;
  product_count?: string;
}

interface ProductRow {
  id: number;
  title: string;
  price: string;
  category_name?: string;
}

interface OrderRow {
  id: number;
  buyer_username?: string;
  buyer_email?: string;
  items?: OrderItemRow[];
}

interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  price: string;
  title: string;
}

interface CountRow {
  count: string;
}

interface ShopStatsRow {
  sales_count: number;
  rating: number;
  review_count: number;
  pending_orders?: string;
  shipped_orders?: string;
  delivered_orders?: string;
  total_revenue?: string;
  total_views?: string;
  total_favorites?: string;
}

interface CreateShopBody {
  name: string;
  description?: string;
  location?: string;
  shippingPolicy?: object;
  returnPolicy?: string;
}

interface UpdateShopBody {
  name?: string;
  description?: string;
  location?: string;
  bannerImage?: string;
  logoImage?: string;
  shippingPolicy?: object;
  returnPolicy?: string;
}

// Get all shops (with pagination)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };

    const result = await db.query<ShopRow>(
      `SELECT s.*, u.username as owner_username,
              (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.is_active = true) as product_count
       FROM shops s
       JOIN users u ON s.owner_id = u.id
       WHERE s.is_active = true
       ORDER BY s.sales_count DESC, s.rating DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query<CountRow>('SELECT COUNT(*) FROM shops WHERE is_active = true');

    res.json({
      shops: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    logger.error({ error }, 'Get shops error');
    res.status(500).json({ error: 'Failed to get shops' });
  }
});

// Get shop by slug (with caching)
router.get('/slug/:slug', async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;

    const shop = await getCachedShop<ShopRow | null>(slug, async () => {
      const result = await db.query<ShopRow>(
        `SELECT s.*, u.username as owner_username, u.full_name as owner_name,
                (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.is_active = true) as product_count
         FROM shops s
         JOIN users u ON s.owner_id = u.id
         WHERE s.slug = $1 AND s.is_active = true`,
        [slug]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    });

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({ shop });
  } catch (error) {
    logger.error({ error }, 'Get shop error');
    res.status(500).json({ error: 'Failed to get shop' });
  }
});

// Get shop by ID (with caching)
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const shopId = parseInt(id);

    const shop = await getCachedShop<ShopRow | null>(shopId, async () => {
      const result = await db.query<ShopRow>(
        `SELECT s.*, u.username as owner_username, u.full_name as owner_name,
                (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.is_active = true) as product_count
         FROM shops s
         JOIN users u ON s.owner_id = u.id
         WHERE s.id = $1 AND s.is_active = true`,
        [shopId]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    });

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({ shop });
  } catch (error) {
    logger.error({ error }, 'Get shop error');
    res.status(500).json({ error: 'Failed to get shop' });
  }
});

// Get shop products (with caching)
router.get('/:id/products', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const shopId = parseInt(id);
    const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };

    const cacheKey = `${CACHE_KEYS.SHOP_PRODUCTS}${shopId}:${limit}:${offset}`;

    interface ShopProductsData {
      products: ProductRow[];
      total: number;
    }

    const data = await cacheAside<ShopProductsData>(
      cacheKey,
      async () => {
        const result = await db.query<ProductRow>(
          `SELECT p.*, c.name as category_name
           FROM products p
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE p.shop_id = $1 AND p.is_active = true
           ORDER BY p.created_at DESC
           LIMIT $2 OFFSET $3`,
          [shopId, parseInt(limit), parseInt(offset)]
        );

        const countResult = await db.query<CountRow>(
          'SELECT COUNT(*) FROM products WHERE shop_id = $1 AND is_active = true',
          [shopId]
        );

        return {
          products: result.rows,
          total: parseInt(countResult.rows[0].count),
        };
      },
      CACHE_TTL.SHOP_PRODUCTS,
      'shop'
    );

    res.json(data);
  } catch (error) {
    logger.error({ error }, 'Get shop products error');
    res.status(500).json({ error: 'Failed to get shop products' });
  }
});

// Create shop (requires auth)
router.post('/', isAuthenticated, async (req: Request<object, object, CreateShopBody>, res: Response) => {
  try {
    const { name, description, location, shippingPolicy, returnPolicy } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Shop name is required' });
    }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check if shop name or slug exists
    const existing = await db.query<{ id: number }>(
      'SELECT id FROM shops WHERE name = $1 OR slug = $2',
      [name, slug]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Shop name already exists' });
    }

    const result = await db.query<ShopRow>(
      `INSERT INTO shops (owner_id, name, slug, description, location, shipping_policy, return_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.session.userId,
        name,
        slug,
        description || null,
        location || null,
        JSON.stringify(shippingPolicy || {}),
        returnPolicy || null,
      ]
    );

    const shop = result.rows[0];

    // Update session with new shop
    if (!req.session.shopIds) {
      req.session.shopIds = [];
    }
    req.session.shopIds.push(shop.id);

    logger.info({ shopId: shop.id, userId: req.session.userId }, 'Shop created');
    res.status(201).json({ shop });
  } catch (error) {
    logger.error({ error }, 'Create shop error');
    res.status(500).json({ error: 'Failed to create shop' });
  }
});

// Update shop (requires auth and ownership)
router.put('/:id', isAuthenticated, async (req: Request<{ id: string }, object, UpdateShopBody>, res: Response) => {
  try {
    const { id } = req.params;
    const shopId = parseInt(id);

    // Check ownership
    if (!req.session.shopIds || !req.session.shopIds.includes(shopId)) {
      return res.status(403).json({ error: 'You do not own this shop' });
    }

    // Get current shop data to get slug for cache invalidation
    const currentShop = await db.query<{ slug: string }>('SELECT slug FROM shops WHERE id = $1', [shopId]);
    const oldSlug = currentShop.rows[0]?.slug;

    const { name, description, location, bannerImage, logoImage, shippingPolicy, returnPolicy } = req.body;

    const result = await db.query<ShopRow>(
      `UPDATE shops SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        location = COALESCE($3, location),
        banner_image = COALESCE($4, banner_image),
        logo_image = COALESCE($5, logo_image),
        shipping_policy = COALESCE($6, shipping_policy),
        return_policy = COALESCE($7, return_policy),
        updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        name || null,
        description || null,
        location || null,
        bannerImage || null,
        logoImage || null,
        shippingPolicy ? JSON.stringify(shippingPolicy) : null,
        returnPolicy || null,
        shopId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = result.rows[0];

    // Invalidate shop cache (both by ID and slug)
    await invalidateShopCache(shopId, oldSlug);
    if (shop.slug !== oldSlug) {
      await invalidateShopCache(shopId, shop.slug);
    }

    logger.info({ shopId }, 'Shop updated');
    res.json({ shop: shop });
  } catch (error) {
    logger.error({ error }, 'Update shop error');
    res.status(500).json({ error: 'Failed to update shop' });
  }
});

// Get shop orders (for seller dashboard)
router.get('/:id/orders', isAuthenticated, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const shopId = parseInt(id);

    // Check ownership
    if (!req.session.shopIds || !req.session.shopIds.includes(shopId)) {
      return res.status(403).json({ error: 'You do not own this shop' });
    }

    const { status, limit = '20', offset = '0' } = req.query as { status?: string; limit?: string; offset?: string };

    let query = `
      SELECT o.*, u.username as buyer_username, u.email as buyer_email
      FROM orders o
      LEFT JOIN users u ON o.buyer_id = u.id
      WHERE o.shop_id = $1
    `;
    const params: (number | string)[] = [shopId];

    if (status) {
      query += ` AND o.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query<OrderRow>(query, params);

    // Get order items for each order
    for (const order of result.rows) {
      const itemsResult = await db.query<OrderItemRow>(
        'SELECT * FROM order_items WHERE order_id = $1',
        [order.id]
      );
      order.items = itemsResult.rows;
    }

    res.json({ orders: result.rows });
  } catch (error) {
    logger.error({ error }, 'Get shop orders error');
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Get shop stats (for seller dashboard)
router.get('/:id/stats', isAuthenticated, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const shopId = parseInt(id);

    // Check ownership
    if (!req.session.shopIds || !req.session.shopIds.includes(shopId)) {
      return res.status(403).json({ error: 'You do not own this shop' });
    }

    const shopResult = await db.query<ShopStatsRow>(
      'SELECT sales_count, rating, review_count FROM shops WHERE id = $1',
      [shopId]
    );

    const productCountResult = await db.query<CountRow>(
      'SELECT COUNT(*) FROM products WHERE shop_id = $1 AND is_active = true',
      [shopId]
    );

    const orderStatsResult = await db.query<ShopStatsRow>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_orders,
        COUNT(*) FILTER (WHERE status = 'shipped') as shipped_orders,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered_orders,
        COALESCE(SUM(total), 0) as total_revenue
       FROM orders WHERE shop_id = $1`,
      [shopId]
    );

    const viewsResult = await db.query<{ total_views: string }>(
      'SELECT COALESCE(SUM(view_count), 0) as total_views FROM products WHERE shop_id = $1',
      [shopId]
    );

    const favoritesResult = await db.query<{ total_favorites: string }>(
      'SELECT COALESCE(SUM(favorite_count), 0) as total_favorites FROM products WHERE shop_id = $1',
      [shopId]
    );

    res.json({
      stats: {
        ...shopResult.rows[0],
        productCount: parseInt(productCountResult.rows[0].count),
        ...orderStatsResult.rows[0],
        totalViews: parseInt(viewsResult.rows[0].total_views),
        totalFavorites: parseInt(favoritesResult.rows[0].total_favorites),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Get shop stats error');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
