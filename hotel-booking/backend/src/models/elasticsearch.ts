import { Client, estypes } from '@elastic/elasticsearch';
import config from '../config/index.js';

const client: Client = new Client({
  node: config.elasticsearch.url,
});

// Index name for hotels
export const HOTELS_INDEX = 'hotels';

// Types for hotel documents
export interface HotelRoomTypeDoc {
  id: string;
  name: string;
  capacity: number;
  base_price: number;
  amenities: string[];
}

export interface HotelDocument {
  hotel_id: string;
  name: string;
  description: string;
  city: string;
  state: string;
  country: string;
  address: string;
  location: { lat: number; lon: number } | null;
  star_rating: number;
  amenities: string[];
  images: string[];
  check_in_time: string;
  check_out_time: string;
  is_active: boolean;
  room_types: HotelRoomTypeDoc[];
  min_price: number;
  max_capacity: number;
  avg_rating: number;
  review_count: number;
}

export interface SearchHotelsParams {
  city?: string;
  country?: string;
  guests?: number;
  minStars?: string;
  maxPrice?: string;
  minPrice?: string;
  amenities?: string | string[];
  lat?: string;
  lon?: string;
  radius?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
}

export interface SearchHotelsResult {
  hotels: (HotelDocument & { _score: number | null })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Create or update the hotels index mapping
export async function setupIndex(): Promise<void> {
  try {
    const indexExists = await client.indices.exists({ index: HOTELS_INDEX });

    if (!indexExists) {
      await client.indices.create({
        index: HOTELS_INDEX,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
          },
          mappings: {
            properties: {
              hotel_id: { type: 'keyword' },
              name: { type: 'text', analyzer: 'standard' },
              description: { type: 'text' },
              city: { type: 'keyword' },
              state: { type: 'keyword' },
              country: { type: 'keyword' },
              address: { type: 'text' },
              location: { type: 'geo_point' },
              star_rating: { type: 'integer' },
              amenities: { type: 'keyword' },
              images: { type: 'keyword' },
              check_in_time: { type: 'keyword' },
              check_out_time: { type: 'keyword' },
              is_active: { type: 'boolean' },
              room_types: {
                type: 'nested',
                properties: {
                  id: { type: 'keyword' },
                  name: { type: 'text' },
                  capacity: { type: 'integer' },
                  base_price: { type: 'float' },
                  amenities: { type: 'keyword' },
                },
              },
              min_price: { type: 'float' },
              max_capacity: { type: 'integer' },
              avg_rating: { type: 'float' },
              review_count: { type: 'integer' },
            },
          },
        },
      });
      console.log('Elasticsearch hotels index created');
    }
  } catch (error) {
    console.error('Error setting up Elasticsearch index:', error);
  }
}

// Index a hotel document
export async function indexHotel(hotel: HotelDocument): Promise<void> {
  try {
    await client.index({
      index: HOTELS_INDEX,
      id: hotel.hotel_id,
      body: hotel,
      refresh: true,
    });
  } catch (error) {
    console.error('Error indexing hotel:', error);
    throw error;
  }
}

// Remove a hotel from the index
export async function removeHotel(hotelId: string): Promise<void> {
  try {
    await client.delete({
      index: HOTELS_INDEX,
      id: hotelId,
      refresh: true,
    });
  } catch (error) {
    const esError = error as { statusCode?: number };
    if (esError.statusCode !== 404) {
      console.error('Error removing hotel from index:', error);
      throw error;
    }
  }
}

// Search hotels
export async function searchHotels(params: SearchHotelsParams): Promise<SearchHotelsResult> {
  const {
    city,
    country,
    guests,
    minStars,
    maxPrice,
    minPrice,
    amenities,
    lat,
    lon,
    radius = '50km',
    page = 1,
    limit = 20,
    sortBy = 'relevance',
  } = params;

  const must: estypes.QueryDslQueryContainer[] = [];
  const filter: estypes.QueryDslQueryContainer[] = [];

  // Location filter (city or geo-distance)
  if (city) {
    must.push({ match: { city: city } });
  }

  if (country) {
    filter.push({ term: { country: country } });
  }

  if (lat && lon) {
    filter.push({
      geo_distance: {
        distance: radius,
        location: { lat: parseFloat(lat), lon: parseFloat(lon) },
      },
    });
  }

  // Guest capacity filter
  if (guests) {
    filter.push({ range: { max_capacity: { gte: guests } } });
  }

  // Star rating filter
  if (minStars) {
    filter.push({ range: { star_rating: { gte: parseInt(minStars, 10) } } });
  }

  // Price filters
  if (minPrice) {
    filter.push({ range: { min_price: { gte: parseFloat(minPrice) } } });
  }
  if (maxPrice) {
    filter.push({ range: { min_price: { lte: parseFloat(maxPrice) } } });
  }

  // Amenities filter
  if (amenities && amenities.length > 0) {
    const amenityList = Array.isArray(amenities) ? amenities : [amenities];
    filter.push({ terms: { amenities: amenityList } });
  }

  // Only active hotels
  filter.push({ term: { is_active: true } });

  // Build sort
  type SortItem = Record<string, estypes.SortOrder>;
  let sort: SortItem[] = [];
  switch (sortBy) {
    case 'price_asc':
      sort = [{ min_price: 'asc' }];
      break;
    case 'price_desc':
      sort = [{ min_price: 'desc' }];
      break;
    case 'rating':
      sort = [{ avg_rating: 'desc' }];
      break;
    case 'stars':
      sort = [{ star_rating: 'desc' }];
      break;
    default:
      sort = [{ _score: 'desc' }, { avg_rating: 'desc' }];
  }

  const query: estypes.QueryDslQueryContainer = {
    bool: {
      must: must.length > 0 ? must : [{ match_all: {} }],
      filter,
    },
  };

  try {
    const result = await client.search<HotelDocument>({
      index: HOTELS_INDEX,
      body: {
        from: (page - 1) * limit,
        size: limit,
        query,
        sort,
      },
    });

    const hits = result.hits.hits.map((hit) => ({
      ...hit._source!,
      _score: hit._score ?? null,
    }));

    const total = typeof result.hits.total === 'object'
      ? result.hits.total.value
      : (result.hits.total ?? 0);

    return {
      hotels: hits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  } catch (error) {
    console.error('Error searching hotels:', error);
    throw error;
  }
}

// Get the Elasticsearch client (for health checks)
export function getClient(): Client {
  return client;
}

export { client };

export default {
  client,
  getClient,
  HOTELS_INDEX,
  setupIndex,
  indexHotel,
  removeHotel,
  searchHotels,
};
