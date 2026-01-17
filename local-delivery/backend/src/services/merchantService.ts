import { query, queryOne, execute } from '../utils/db.js';
import { haversineDistance } from '../utils/geo.js';
import type { Merchant, MerchantWithDistance, MenuItem, Location } from '../types/index.js';

/**
 * Retrieves a merchant by their unique identifier.
 *
 * @param id - The merchant's UUID
 * @returns Merchant profile or null if not found
 */
export async function getMerchantById(id: string): Promise<Merchant | null> {
  return queryOne<Merchant>(`SELECT * FROM merchants WHERE id = $1`, [id]);
}

/**
 * Retrieves all open merchants in a specific category.
 * Results sorted by rating (highest first).
 *
 * @param category - Category name (e.g., 'Pizza', 'Asian', 'Coffee')
 * @returns Array of merchants in the category
 */
export async function getMerchantsByCategory(category: string): Promise<Merchant[]> {
  return query<Merchant>(
    `SELECT * FROM merchants WHERE category = $1 AND is_open = true ORDER BY rating DESC`,
    [category]
  );
}

/**
 * Finds open merchants within a specified radius of a location.
 * Calculates distance using the Haversine formula and filters by radius.
 * Essential for the main merchant discovery page.
 *
 * @param location - Customer's delivery location
 * @param radiusKm - Maximum delivery distance in kilometers (default 10)
 * @param category - Optional category filter
 * @returns Array of merchants with distances, sorted by proximity
 */
export async function getNearbyMerchants(
  location: Location,
  radiusKm: number = 10,
  category?: string
): Promise<MerchantWithDistance[]> {
  let sql = `SELECT * FROM merchants WHERE is_open = true`;
  const params: unknown[] = [];

  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  const merchants = await query<Merchant>(sql, params);

  // Calculate distance and filter by radius
  const merchantsWithDistance = merchants
    .map((merchant) => ({
      ...merchant,
      distance: haversineDistance(location, { lat: merchant.lat, lng: merchant.lng }),
    }))
    .filter((m) => m.distance <= radiusKm);

  // Sort by distance
  return merchantsWithDistance.sort((a, b) => a.distance - b.distance);
}

/**
 * Retrieves all available menu items for a merchant.
 * Items are sorted by category, then by name for consistent display.
 *
 * @param merchantId - The merchant's UUID
 * @returns Array of available menu items
 */
export async function getMerchantMenu(merchantId: string): Promise<MenuItem[]> {
  return query<MenuItem>(
    `SELECT * FROM menu_items
     WHERE merchant_id = $1 AND is_available = true
     ORDER BY category, name`,
    [merchantId]
  );
}

/**
 * Retrieves a single menu item by its unique identifier.
 *
 * @param id - The menu item's UUID
 * @returns Menu item or null if not found
 */
export async function getMenuItem(id: string): Promise<MenuItem | null> {
  return queryOne<MenuItem>(`SELECT * FROM menu_items WHERE id = $1`, [id]);
}

/**
 * Retrieves multiple menu items by their IDs.
 * Used during order creation to validate and price items.
 *
 * @param ids - Array of menu item UUIDs
 * @returns Array of found menu items
 */
export async function getMenuItemsByIds(ids: string[]): Promise<MenuItem[]> {
  return query<MenuItem>(
    `SELECT * FROM menu_items WHERE id = ANY($1)`,
    [ids]
  );
}

/**
 * Updates a merchant's open/closed status.
 * Allows merchants to manually close during breaks or emergencies.
 *
 * @param id - The merchant's UUID
 * @param isOpen - New open status
 * @returns Updated merchant or null if not found
 */
export async function updateMerchantOpenStatus(
  id: string,
  isOpen: boolean
): Promise<Merchant | null> {
  return queryOne<Merchant>(
    `UPDATE merchants SET is_open = $1 WHERE id = $2 RETURNING *`,
    [isOpen, id]
  );
}

/**
 * Recalculates a merchant's average rating from all customer ratings.
 * Called after a customer submits a new rating for a completed order.
 *
 * @param id - The merchant's UUID
 */
export async function updateMerchantRating(id: string): Promise<void> {
  const result = await queryOne<{ avg: number }>(
    `SELECT AVG(r.rating)::DECIMAL(3,2) as avg
     FROM ratings r
     WHERE r.rated_merchant_id = $1`,
    [id]
  );

  if (result?.avg) {
    await execute(`UPDATE merchants SET rating = $1 WHERE id = $2`, [result.avg, id]);
  }
}

/**
 * Creates a new merchant in the system.
 * Used by admins to onboard new restaurants and stores.
 *
 * @param data - Merchant information excluding auto-generated fields
 * @returns The newly created merchant
 * @throws Error if creation fails
 */
export async function createMerchant(
  data: Omit<Merchant, 'id' | 'created_at' | 'updated_at' | 'rating'>
): Promise<Merchant> {
  const result = await queryOne<Merchant>(
    `INSERT INTO merchants (owner_id, name, description, address, lat, lng, category, avg_prep_time_minutes, is_open, opens_at, closes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.owner_id,
      data.name,
      data.description,
      data.address,
      data.lat,
      data.lng,
      data.category,
      data.avg_prep_time_minutes,
      data.is_open,
      data.opens_at,
      data.closes_at,
    ]
  );

  if (!result) {
    throw new Error('Failed to create merchant');
  }

  return result;
}

/**
 * Creates a new menu item for a merchant.
 * Allows merchants to add dishes or products to their menu.
 *
 * @param data - Menu item information excluding auto-generated fields
 * @returns The newly created menu item
 * @throws Error if creation fails
 */
export async function createMenuItem(
  data: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>
): Promise<MenuItem> {
  const result = await queryOne<MenuItem>(
    `INSERT INTO menu_items (merchant_id, name, description, price, category, image_url, is_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.merchant_id,
      data.name,
      data.description,
      data.price,
      data.category,
      data.image_url,
      data.is_available,
    ]
  );

  if (!result) {
    throw new Error('Failed to create menu item');
  }

  return result;
}

/**
 * Updates an existing menu item's details.
 * Allows merchants to modify prices, descriptions, or availability.
 *
 * @param id - The menu item's UUID
 * @param updates - Partial menu item data to update
 * @returns Updated menu item or null if not found
 */
export async function updateMenuItem(
  id: string,
  updates: Partial<Pick<MenuItem, 'name' | 'description' | 'price' | 'category' | 'is_available'>>
): Promise<MenuItem | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.price !== undefined) {
    fields.push(`price = $${paramIndex++}`);
    values.push(updates.price);
  }
  if (updates.category !== undefined) {
    fields.push(`category = $${paramIndex++}`);
    values.push(updates.category);
  }
  if (updates.is_available !== undefined) {
    fields.push(`is_available = $${paramIndex++}`);
    values.push(updates.is_available);
  }

  if (fields.length === 0) {
    return getMenuItem(id);
  }

  values.push(id);

  return queryOne<MenuItem>(
    `UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

/**
 * Removes a menu item from the system.
 * Items should typically be marked unavailable instead of deleted.
 *
 * @param id - The menu item's UUID
 * @returns True if deleted, false if not found
 */
export async function deleteMenuItem(id: string): Promise<boolean> {
  const count = await execute(`DELETE FROM menu_items WHERE id = $1`, [id]);
  return count > 0;
}

/**
 * Searches for merchants by name, category, or description.
 * Case-insensitive search with optional location filtering.
 *
 * @param searchTerm - Search query string
 * @param location - Optional customer location for distance filtering
 * @param radiusKm - Maximum distance in kilometers (default 10)
 * @returns Array of matching merchants with distances
 */
export async function searchMerchants(
  searchTerm: string,
  location?: Location,
  radiusKm: number = 10
): Promise<MerchantWithDistance[]> {
  const merchants = await query<Merchant>(
    `SELECT * FROM merchants
     WHERE is_open = true
     AND (name ILIKE $1 OR category ILIKE $1 OR description ILIKE $1)`,
    [`%${searchTerm}%`]
  );

  if (!location) {
    return merchants.map((m) => ({ ...m, distance: 0 }));
  }

  const merchantsWithDistance = merchants
    .map((merchant) => ({
      ...merchant,
      distance: haversineDistance(location, { lat: merchant.lat, lng: merchant.lng }),
    }))
    .filter((m) => m.distance <= radiusKm);

  return merchantsWithDistance.sort((a, b) => a.distance - b.distance);
}

/**
 * Retrieves all unique merchant categories in the system.
 * Used to populate category filters in the UI.
 *
 * @returns Array of unique category names, sorted alphabetically
 */
export async function getCategories(): Promise<string[]> {
  const result = await query<{ category: string }>(
    `SELECT DISTINCT category FROM merchants WHERE is_open = true ORDER BY category`
  );
  return result.map((r) => r.category);
}
