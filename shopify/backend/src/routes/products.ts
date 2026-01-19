import { Request, Response } from 'express';
import { queryWithTenant } from '../services/db.js';
import logger from '../services/logger.js';
import { logInventoryChange, ActorType, ActorTypeValue } from '../services/audit.js';
import { publishInventoryUpdated } from '../services/rabbitmq.js';
import { inventoryLevel, inventoryLow, inventoryOutOfStock } from '../services/metrics.js';
import config from '../config/index.js';

// Product interface
interface Product {
  id: number;
  store_id: number;
  handle: string;
  title: string;
  description: string | null;
  images: Array<{ url: string }>;
  status: string;
  tags: string[];
  created_at: Date;
  updated_at: Date;
  variants?: Variant[];
}

// Variant interface
interface Variant {
  id: number;
  product_id: number;
  store_id: number;
  sku: string | null;
  title: string;
  price: number;
  compare_at_price: number | null;
  inventory_quantity: number;
  options: Record<string, unknown>;
  product_title?: string;
}

// Audit context interface
interface AuditContext {
  storeId: number | null;
  userId: number | null;
  userType: ActorTypeValue | string;
  ip?: string;
  userAgent?: string;
}

// List products for store (admin)
export async function listProducts(req: Request, res: Response): Promise<void> {
  const { storeId } = req;

  const result = await queryWithTenant(
    storeId!,
    `SELECT p.id, p.handle, p.title, p.description, p.images, p.status, p.tags,
            p.created_at, p.updated_at,
            (SELECT json_agg(v.*) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p
     ORDER BY p.created_at DESC`
  );

  res.json({ products: result.rows });
}

// Get single product (admin)
export async function getProduct(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { productId } = req.params;

  const result = await queryWithTenant(
    storeId!,
    `SELECT p.*, (SELECT json_agg(v.*) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p WHERE p.id = $1`,
    [productId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json({ product: result.rows[0] });
}

// Request body interface for create product
interface CreateProductBody {
  title: string;
  description?: string;
  handle?: string;
  status?: string;
  images?: Array<{ url: string }>;
  tags?: string[];
  variants?: Array<{
    sku?: string;
    title?: string;
    price?: number;
    compare_at_price?: number;
    inventory_quantity?: number;
    options?: Record<string, unknown>;
  }>;
}

// Create product
export async function createProduct(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { title, description, handle, status, images, tags, variants }: CreateProductBody = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  // Generate handle if not provided
  const productHandle = handle || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Check handle uniqueness within store
  const existing = await queryWithTenant(
    storeId!,
    'SELECT id FROM products WHERE handle = $1',
    [productHandle]
  );

  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Product handle already exists' });
  }

  const result = await queryWithTenant(
    storeId!,
    `INSERT INTO products (store_id, title, description, handle, status, images, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      storeId,
      title,
      description || null,
      productHandle,
      status || 'draft',
      JSON.stringify(images || []),
      JSON.stringify(tags || []),
    ]
  );

  const product = result.rows[0] as Product;

  // Create variants if provided
  if (variants && variants.length > 0) {
    for (const variant of variants) {
      await queryWithTenant(
        storeId!,
        `INSERT INTO variants (product_id, store_id, sku, title, price, compare_at_price, inventory_quantity, options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          product.id,
          storeId,
          variant.sku || null,
          variant.title || 'Default',
          variant.price || 0,
          variant.compare_at_price || null,
          variant.inventory_quantity || 0,
          JSON.stringify(variant.options || {}),
        ]
      );
    }
  } else {
    // Create default variant
    await queryWithTenant(
      storeId!,
      `INSERT INTO variants (product_id, store_id, title, price, inventory_quantity)
       VALUES ($1, $2, $3, $4, $5)`,
      [product.id, storeId, 'Default', 0, 0]
    );
  }

  // Fetch complete product with variants
  const fullProduct = await queryWithTenant(
    storeId!,
    `SELECT p.*, (SELECT json_agg(v.*) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p WHERE p.id = $1`,
    [product.id]
  );

  res.status(201).json({ product: fullProduct.rows[0] });
}

// Update product
export async function updateProduct(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { productId } = req.params;
  const { title, description, handle, status, images, tags } = req.body;

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramCount = 1;

  if (title !== undefined) {
    updates.push(`title = $${paramCount++}`);
    values.push(title);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(description);
  }
  if (handle !== undefined) {
    updates.push(`handle = $${paramCount++}`);
    values.push(handle);
  }
  if (status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(status);
  }
  if (images !== undefined) {
    updates.push(`images = $${paramCount++}`);
    values.push(JSON.stringify(images));
  }
  if (tags !== undefined) {
    updates.push(`tags = $${paramCount++}`);
    values.push(JSON.stringify(tags));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = NOW()`);
  values.push(productId);

  const result = await queryWithTenant(
    storeId!,
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Fetch with variants
  const fullProduct = await queryWithTenant(
    storeId!,
    `SELECT p.*, (SELECT json_agg(v.*) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p WHERE p.id = $1`,
    [productId]
  );

  res.json({ product: fullProduct.rows[0] });
}

// Delete product
export async function deleteProduct(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { productId } = req.params;

  const result = await queryWithTenant(
    storeId!,
    'DELETE FROM products WHERE id = $1 RETURNING id',
    [productId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json({ success: true });
}

// Update variant
export async function updateVariant(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { variantId } = req.params;
  const { sku, title, price, compare_at_price, inventory_quantity, options } = req.body;

  // Get current state for audit logging if inventory is changing
  let oldInventoryQuantity: number | null = null;
  if (inventory_quantity !== undefined) {
    const currentResult = await queryWithTenant(
      storeId!,
      'SELECT inventory_quantity, sku FROM variants WHERE id = $1',
      [variantId]
    );
    if (currentResult.rows.length > 0) {
      oldInventoryQuantity = (currentResult.rows[0] as Variant).inventory_quantity;
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramCount = 1;

  if (sku !== undefined) {
    updates.push(`sku = $${paramCount++}`);
    values.push(sku);
  }
  if (title !== undefined) {
    updates.push(`title = $${paramCount++}`);
    values.push(title);
  }
  if (price !== undefined) {
    updates.push(`price = $${paramCount++}`);
    values.push(price);
  }
  if (compare_at_price !== undefined) {
    updates.push(`compare_at_price = $${paramCount++}`);
    values.push(compare_at_price);
  }
  if (inventory_quantity !== undefined) {
    updates.push(`inventory_quantity = $${paramCount++}`);
    values.push(inventory_quantity);
  }
  if (options !== undefined) {
    updates.push(`options = $${paramCount++}`);
    values.push(JSON.stringify(options));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = NOW()`);
  values.push(variantId);

  const result = await queryWithTenant(
    storeId!,
    `UPDATE variants SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  const variant = result.rows[0] as Variant;

  // If inventory was updated, log it and update metrics
  if (inventory_quantity !== undefined && oldInventoryQuantity !== null && oldInventoryQuantity !== inventory_quantity) {
    const auditContext: AuditContext = {
      storeId: storeId!,
      userId: req.user?.id || null,
      userType: req.user?.role || ActorType.MERCHANT,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    };

    // Audit log the inventory change
    await logInventoryChange(
      auditContext,
      parseInt(variantId),
      oldInventoryQuantity,
      inventory_quantity,
      'manual_adjustment'
    );

    // Update inventory metrics
    inventoryLevel.set(
      { store_id: storeId!.toString(), variant_id: variantId.toString(), sku: variant.sku || '' },
      inventory_quantity
    );

    // Check for low/out of stock
    if (inventory_quantity === 0) {
      inventoryOutOfStock.inc({ store_id: storeId!.toString(), variant_id: variantId.toString() });
    } else if (inventory_quantity < config.inventory.lowStockThreshold) {
      inventoryLow.inc({ store_id: storeId!.toString(), variant_id: variantId.toString() });
    }

    // Publish inventory update event
    await publishInventoryUpdated(storeId!, parseInt(variantId), oldInventoryQuantity, inventory_quantity);

    logger.info({
      storeId,
      variantId,
      oldQuantity: oldInventoryQuantity,
      newQuantity: inventory_quantity,
    }, 'Inventory manually adjusted');
  }

  res.json({ variant });
}

// Add variant to product
export async function addVariant(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { productId } = req.params;
  const { sku, title, price, compare_at_price, inventory_quantity, options } = req.body;

  // Verify product exists
  const product = await queryWithTenant(
    storeId!,
    'SELECT id FROM products WHERE id = $1',
    [productId]
  );

  if (product.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const result = await queryWithTenant(
    storeId!,
    `INSERT INTO variants (product_id, store_id, sku, title, price, compare_at_price, inventory_quantity, options)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      productId,
      storeId,
      sku || null,
      title || 'Default',
      price || 0,
      compare_at_price || null,
      inventory_quantity || 0,
      JSON.stringify(options || {}),
    ]
  );

  res.status(201).json({ variant: result.rows[0] });
}

// Delete variant
export async function deleteVariant(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { variantId } = req.params;

  const result = await queryWithTenant(
    storeId!,
    'DELETE FROM variants WHERE id = $1 RETURNING id',
    [variantId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Variant not found' });
  }

  res.json({ success: true });
}

// === Storefront Routes (public) ===

// List products for storefront (only active)
export async function listStorefrontProducts(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;

  if (!storeId) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const result = await queryWithTenant(
    storeId,
    `SELECT p.id, p.handle, p.title, p.description, p.images, p.tags,
            (SELECT json_agg(json_build_object(
              'id', v.id,
              'title', v.title,
              'price', v.price,
              'compare_at_price', v.compare_at_price,
              'inventory_quantity', v.inventory_quantity,
              'options', v.options
            )) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p
     WHERE p.status = 'active'
     ORDER BY p.created_at DESC`
  );

  res.json({ products: result.rows });
}

// Get single product for storefront
export async function getStorefrontProduct(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { handle } = req.params;

  if (!storeId) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const result = await queryWithTenant(
    storeId,
    `SELECT p.id, p.handle, p.title, p.description, p.images, p.tags,
            (SELECT json_agg(json_build_object(
              'id', v.id,
              'title', v.title,
              'sku', v.sku,
              'price', v.price,
              'compare_at_price', v.compare_at_price,
              'inventory_quantity', v.inventory_quantity,
              'options', v.options
            )) FROM variants v WHERE v.product_id = p.id) as variants
     FROM products p
     WHERE p.handle = $1 AND p.status = 'active'`,
    [handle]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json({ product: result.rows[0] });
}
