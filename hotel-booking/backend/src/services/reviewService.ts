import { query } from '../models/db.js';

export interface CreateReviewData {
  bookingId: string;
  rating: number;
  title: string;
  content: string;
}

export interface Review {
  id: string;
  bookingId: string;
  userId: string;
  hotelId: string;
  rating: number;
  title: string;
  content: string;
  createdAt: Date;
}

export interface ReviewWithAuthor extends Review {
  authorFirstName: string;
  authorLastName: string;
}

export interface ReviewsPage {
  reviews: ReviewWithAuthor[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReviewStats {
  totalReviews: number;
  avgRating: number;
  distribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

interface ReviewRow {
  id: string;
  booking_id: string;
  user_id: string;
  hotel_id: string;
  rating: number;
  title: string;
  content: string;
  created_at: Date;
  first_name?: string;
  last_name?: string;
}

interface ReviewStatsRow {
  total_reviews: string;
  avg_rating: string | null;
  five_star: string;
  four_star: string;
  three_star: string;
  two_star: string;
  one_star: string;
}

class ReviewService {
  async createReview(reviewData: CreateReviewData, userId: string): Promise<Review> {
    const { bookingId, rating, title, content } = reviewData;

    // Verify the booking belongs to the user and is completed/confirmed
    const bookingResult = await query<{ hotel_id: string }>(
      `SELECT hotel_id FROM bookings
       WHERE id = $1 AND user_id = $2 AND status IN ('confirmed', 'completed')`,
      [bookingId, userId]
    );

    if (bookingResult.rows.length === 0) {
      throw new Error('Booking not found or not eligible for review');
    }

    const hotelId = bookingResult.rows[0]?.hotel_id;
    if (!hotelId) {
      throw new Error('Booking not found');
    }

    // Check if review already exists
    const existingResult = await query<{ id: string }>(
      'SELECT id FROM reviews WHERE booking_id = $1',
      [bookingId]
    );

    if (existingResult.rows.length > 0) {
      throw new Error('Review already submitted for this booking');
    }

    const result = await query<ReviewRow>(
      `INSERT INTO reviews (booking_id, user_id, hotel_id, rating, title, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [bookingId, userId, hotelId, rating, title, content]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create review');
    }

    return this.formatReview(row);
  }

  async getReviewsByHotel(hotelId: string, page: number = 1, limit: number = 10): Promise<ReviewsPage> {
    const offset = (page - 1) * limit;

    const result = await query<ReviewRow>(
      `SELECT r.*, u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.hotel_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [hotelId, limit, offset]
    );

    const countResult = await query<{ total: string }>(
      'SELECT COUNT(*) as total FROM reviews WHERE hotel_id = $1',
      [hotelId]
    );

    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    return {
      reviews: result.rows.map((row) => ({
        ...this.formatReview(row),
        authorFirstName: row.first_name ?? '',
        authorLastName: row.last_name ?? '',
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReviewStats(hotelId: string): Promise<ReviewStats> {
    const result = await query<ReviewStatsRow>(
      `SELECT
         COUNT(*) as total_reviews,
         AVG(rating) as avg_rating,
         COUNT(*) FILTER (WHERE rating = 5) as five_star,
         COUNT(*) FILTER (WHERE rating = 4) as four_star,
         COUNT(*) FILTER (WHERE rating = 3) as three_star,
         COUNT(*) FILTER (WHERE rating = 2) as two_star,
         COUNT(*) FILTER (WHERE rating = 1) as one_star
       FROM reviews
       WHERE hotel_id = $1`,
      [hotelId]
    );

    const row = result.rows[0];
    if (!row) {
      return {
        totalReviews: 0,
        avgRating: 0,
        distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      };
    }

    return {
      totalReviews: parseInt(row.total_reviews, 10) || 0,
      avgRating: parseFloat(row.avg_rating ?? '0') || 0,
      distribution: {
        5: parseInt(row.five_star, 10) || 0,
        4: parseInt(row.four_star, 10) || 0,
        3: parseInt(row.three_star, 10) || 0,
        2: parseInt(row.two_star, 10) || 0,
        1: parseInt(row.one_star, 10) || 0,
      },
    };
  }

  formatReview(row: ReviewRow): Review {
    return {
      id: row.id,
      bookingId: row.booking_id,
      userId: row.user_id,
      hotelId: row.hotel_id,
      rating: row.rating,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
    };
  }
}

export default new ReviewService();
