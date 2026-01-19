import { query } from '../models/db.js';
import hotelService from './hotelService.js';

export interface CreateRoomTypeData {
  name: string;
  description?: string;
  capacity: number;
  bedType?: string;
  totalCount: number;
  basePrice: number;
  amenities?: string[];
  images?: string[];
  sizeSqm?: number;
}

export interface UpdateRoomTypeData {
  name?: string;
  description?: string;
  capacity?: number;
  bedType?: string;
  totalCount?: number;
  basePrice?: number;
  amenities?: string[];
  images?: string[];
  sizeSqm?: number;
  isActive?: boolean;
}

export interface RoomType {
  id: string;
  hotelId: string;
  name: string;
  description: string;
  capacity: number;
  bedType: string;
  totalCount: number;
  basePrice: number;
  amenities: string[];
  images: string[];
  sizeSqm: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceOverride {
  id: string;
  roomTypeId: string;
  date: string;
  price: number;
}

export interface DatePrice {
  date: string;
  price: number;
}

export interface PriceRangeResult {
  basePrice: number;
  prices: DatePrice[];
  totalPrice: number;
}

interface RoomTypeRow {
  id: string;
  hotel_id: string;
  name: string;
  description: string;
  capacity: number;
  bed_type: string;
  total_count: number;
  base_price: string;
  amenities: string[] | null;
  images: string[] | null;
  size_sqm: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PricingOverrideRow {
  id: string;
  room_type_id: string;
  date: Date;
  price: string;
}

class RoomService {
  async createRoomType(hotelId: string, roomData: CreateRoomTypeData, ownerId: string): Promise<RoomType> {
    // Verify hotel ownership
    const ownerCheck = await query<{ id: string }>(
      'SELECT id FROM hotels WHERE id = $1 AND owner_id = $2',
      [hotelId, ownerId]
    );

    if (ownerCheck.rows.length === 0) {
      throw new Error('Hotel not found or access denied');
    }

    const {
      name,
      description,
      capacity,
      bedType,
      totalCount,
      basePrice,
      amenities = [],
      images = [],
      sizeSqm,
    } = roomData;

    const result = await query<RoomTypeRow>(
      `INSERT INTO room_types
       (hotel_id, name, description, capacity, bed_type, total_count, base_price, amenities, images, size_sqm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [hotelId, name, description ?? null, capacity, bedType ?? null, totalCount, basePrice, amenities, images, sizeSqm ?? null]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create room type');
    }

    const roomType = this.formatRoomType(row);

    // Update hotel in Elasticsearch to include new room type
    await hotelService.indexHotelInElasticsearch(hotelId);

    return roomType;
  }

  async updateRoomType(roomTypeId: string, roomData: UpdateRoomTypeData, ownerId: string): Promise<RoomType> {
    // Verify ownership through hotel
    const ownerCheck = await query<{ id: string }>(
      `SELECT rt.id FROM room_types rt
       JOIN hotels h ON rt.hotel_id = h.id
       WHERE rt.id = $1 AND h.owner_id = $2`,
      [roomTypeId, ownerId]
    );

    if (ownerCheck.rows.length === 0) {
      throw new Error('Room type not found or access denied');
    }

    const {
      name,
      description,
      capacity,
      bedType,
      totalCount,
      basePrice,
      amenities,
      images,
      sizeSqm,
      isActive,
    } = roomData;

    const result = await query<RoomTypeRow>(
      `UPDATE room_types SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       capacity = COALESCE($3, capacity),
       bed_type = COALESCE($4, bed_type),
       total_count = COALESCE($5, total_count),
       base_price = COALESCE($6, base_price),
       amenities = COALESCE($7, amenities),
       images = COALESCE($8, images),
       size_sqm = COALESCE($9, size_sqm),
       is_active = COALESCE($10, is_active)
       WHERE id = $11
       RETURNING *`,
      [
        name ?? null,
        description ?? null,
        capacity ?? null,
        bedType ?? null,
        totalCount ?? null,
        basePrice ?? null,
        amenities ?? null,
        images ?? null,
        sizeSqm ?? null,
        isActive ?? null,
        roomTypeId,
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to update room type');
    }

    const roomType = this.formatRoomType(row);

    // Update hotel in Elasticsearch
    await hotelService.indexHotelInElasticsearch(roomType.hotelId);

    return roomType;
  }

  async getRoomTypeById(roomTypeId: string): Promise<RoomType | null> {
    const result = await query<RoomTypeRow>(
      'SELECT * FROM room_types WHERE id = $1',
      [roomTypeId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.formatRoomType(row);
  }

  async getRoomTypesByHotel(hotelId: string): Promise<RoomType[]> {
    const result = await query<RoomTypeRow>(
      'SELECT * FROM room_types WHERE hotel_id = $1 AND is_active = true ORDER BY base_price',
      [hotelId]
    );

    return result.rows.map((row) => this.formatRoomType(row));
  }

  async deleteRoomType(roomTypeId: string, ownerId: string): Promise<boolean> {
    // Get hotel ID first
    const roomResult = await query<{ hotel_id: string }>(
      `SELECT rt.hotel_id FROM room_types rt
       JOIN hotels h ON rt.hotel_id = h.id
       WHERE rt.id = $1 AND h.owner_id = $2`,
      [roomTypeId, ownerId]
    );

    if (roomResult.rows.length === 0) {
      throw new Error('Room type not found or access denied');
    }

    const hotelId = roomResult.rows[0]?.hotel_id;
    if (!hotelId) {
      throw new Error('Room type not found');
    }

    await query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);

    // Update hotel in Elasticsearch
    await hotelService.indexHotelInElasticsearch(hotelId);

    return true;
  }

  // Set price override for a specific date
  async setPriceOverride(roomTypeId: string, date: string, price: number, ownerId: string): Promise<PriceOverride> {
    // Verify ownership
    const ownerCheck = await query<{ id: string }>(
      `SELECT rt.id FROM room_types rt
       JOIN hotels h ON rt.hotel_id = h.id
       WHERE rt.id = $1 AND h.owner_id = $2`,
      [roomTypeId, ownerId]
    );

    if (ownerCheck.rows.length === 0) {
      throw new Error('Room type not found or access denied');
    }

    const result = await query<PricingOverrideRow>(
      `INSERT INTO pricing_overrides (room_type_id, date, price)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_type_id, date)
       DO UPDATE SET price = $3
       RETURNING *`,
      [roomTypeId, date, price]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to set price override');
    }

    return {
      id: row.id,
      roomTypeId: row.room_type_id,
      date: row.date.toISOString().split('T')[0] ?? '',
      price: parseFloat(row.price),
    };
  }

  // Get price for a room type on a specific date (with override if exists)
  async getPrice(roomTypeId: string, date: string): Promise<number> {
    // Check for price override
    const overrideResult = await query<{ price: string }>(
      'SELECT price FROM pricing_overrides WHERE room_type_id = $1 AND date = $2',
      [roomTypeId, date]
    );

    if (overrideResult.rows.length > 0 && overrideResult.rows[0]) {
      return parseFloat(overrideResult.rows[0].price);
    }

    // Fall back to base price
    const roomResult = await query<{ base_price: string }>(
      'SELECT base_price FROM room_types WHERE id = $1',
      [roomTypeId]
    );

    if (roomResult.rows.length === 0 || !roomResult.rows[0]) {
      throw new Error('Room type not found');
    }

    return parseFloat(roomResult.rows[0].base_price);
  }

  // Get prices for a date range
  async getPricesForRange(roomTypeId: string, checkIn: string, checkOut: string): Promise<PriceRangeResult> {
    const roomResult = await query<{ base_price: string }>(
      'SELECT base_price FROM room_types WHERE id = $1',
      [roomTypeId]
    );

    if (roomResult.rows.length === 0 || !roomResult.rows[0]) {
      throw new Error('Room type not found');
    }

    const basePrice = parseFloat(roomResult.rows[0].base_price);

    const overridesResult = await query<{ date: Date; price: string }>(
      'SELECT date, price FROM pricing_overrides WHERE room_type_id = $1 AND date >= $2 AND date < $3',
      [roomTypeId, checkIn, checkOut]
    );

    const overrides: Record<string, number> = {};
    overridesResult.rows.forEach((row) => {
      const dateStr = row.date.toISOString().split('T')[0];
      if (dateStr) {
        overrides[dateStr] = parseFloat(row.price);
      }
    });

    const prices: DatePrice[] = [];
    const start = new Date(checkIn);
    const end = new Date(checkOut);

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0] ?? '';
      prices.push({
        date: dateStr,
        price: overrides[dateStr] ?? basePrice,
      });
    }

    return {
      basePrice,
      prices,
      totalPrice: prices.reduce((sum, p) => sum + p.price, 0),
    };
  }

  formatRoomType(row: RoomTypeRow): RoomType {
    return {
      id: row.id,
      hotelId: row.hotel_id,
      name: row.name,
      description: row.description,
      capacity: row.capacity,
      bedType: row.bed_type,
      totalCount: row.total_count,
      basePrice: parseFloat(row.base_price),
      amenities: row.amenities || [],
      images: row.images || [],
      sizeSqm: row.size_sqm,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export default new RoomService();
