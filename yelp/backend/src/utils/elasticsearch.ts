import { Client } from '@elastic/elasticsearch';

// Types for SearchTotalHits
interface SearchTotalHits {
  value: number;
  relation: string;
}

export const elasticsearch: Client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

const BUSINESS_INDEX = 'businesses';

// Business document interface for Elasticsearch
export interface BusinessDocument {
  id: string;
  name: string;
  description?: string | null;
  categories: string[];
  category_names: string[];
  location: {
    lat: number;
    lon: number;
  };
  address: string;
  city: string;
  state: string;
  zip_code: string;
  rating: number;
  review_count: number;
  price_level?: number | null;
  is_claimed: boolean;
  is_verified: boolean;
  phone?: string | null;
  website?: string | null;
  photo_url?: string | null;
  created_at: string;
  updated_at: string;
}

// Business input for indexing
export interface BusinessInput {
  id: string;
  name: string;
  description?: string | null;
  categories?: string[] | null;
  category_names?: string[] | null;
  latitude: string | number;
  longitude: string | number;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  rating?: string | number | null;
  review_count?: string | number | null;
  price_level?: number | null;
  is_claimed?: boolean;
  is_verified?: boolean;
  phone?: string | null;
  website?: string | null;
  photo_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Search options interface
export interface SearchOptions {
  query?: string;
  category?: string;
  latitude?: string | number;
  longitude?: string | number;
  distance?: string;
  minRating?: string | number;
  maxPriceLevel?: string | number;
  sortBy?: 'relevance' | 'rating' | 'review_count' | 'distance';
  from?: number;
  size?: number;
}

// Search result interface
export interface SearchResult {
  total: number;
  businesses: Array<BusinessDocument & { score?: number | null; distance?: number }>;
  fallback?: boolean;
}

// Autocomplete result interface
export interface AutocompleteResult {
  id: string;
  name: string;
  city: string;
  rating: number;
}

// Index mapping for businesses
const businessMapping = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      name: {
        type: 'text',
        analyzer: 'standard',
        fields: {
          keyword: { type: 'keyword' },
          suggest: {
            type: 'completion',
            analyzer: 'simple',
            preserve_separators: true,
            preserve_position_increments: true,
            max_input_length: 50,
          },
        },
      },
      description: { type: 'text' },
      categories: { type: 'keyword' },
      category_names: { type: 'text' },
      location: { type: 'geo_point' },
      address: { type: 'text' },
      city: {
        type: 'text',
        fields: { keyword: { type: 'keyword' } },
      },
      state: { type: 'keyword' },
      zip_code: { type: 'keyword' },
      rating: { type: 'float' },
      review_count: { type: 'integer' },
      price_level: { type: 'integer' },
      is_claimed: { type: 'boolean' },
      is_verified: { type: 'boolean' },
      phone: { type: 'keyword' },
      website: { type: 'keyword' },
      photo_url: { type: 'keyword' },
      created_at: { type: 'date' },
      updated_at: { type: 'date' },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        autocomplete: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'autocomplete_filter'],
        },
      },
      filter: {
        autocomplete_filter: {
          type: 'edge_ngram',
          min_gram: 1,
          max_gram: 20,
        },
      },
    },
  },
};

// Initialize Elasticsearch index
export async function initElasticsearch(): Promise<void> {
  try {
    const indexExists = await elasticsearch.indices.exists({
      index: BUSINESS_INDEX,
    });

    if (!indexExists) {
      await elasticsearch.indices.create({
        index: BUSINESS_INDEX,
        ...businessMapping,
      });
      console.log(`Created Elasticsearch index: ${BUSINESS_INDEX}`);
    }
  } catch (error) {
    console.error('Elasticsearch initialization error:', error);
    throw error;
  }
}

// Index a business document
export async function indexBusiness(business: BusinessInput): Promise<void> {
  try {
    await elasticsearch.index({
      index: BUSINESS_INDEX,
      id: business.id,
      document: {
        id: business.id,
        name: business.name,
        description: business.description,
        categories: business.categories || [],
        category_names: business.category_names || [],
        location: {
          lat: parseFloat(String(business.latitude)),
          lon: parseFloat(String(business.longitude)),
        },
        address: business.address,
        city: business.city,
        state: business.state,
        zip_code: business.zip_code,
        rating: parseFloat(String(business.rating)) || 0,
        review_count: parseInt(String(business.review_count), 10) || 0,
        price_level: business.price_level,
        is_claimed: business.is_claimed,
        is_verified: business.is_verified,
        phone: business.phone,
        website: business.website,
        photo_url: business.photo_url,
        created_at: business.created_at,
        updated_at: business.updated_at,
      },
      refresh: true,
    });
  } catch (error) {
    console.error('Error indexing business:', error);
    throw error;
  }
}

// Update a business document
export async function updateBusinessIndex(
  businessId: string,
  updates: Partial<BusinessDocument>
): Promise<void> {
  try {
    await elasticsearch.update({
      index: BUSINESS_INDEX,
      id: businessId,
      doc: updates,
      refresh: true,
    });
  } catch (error) {
    console.error('Error updating business index:', error);
    throw error;
  }
}

// Delete a business document
export async function deleteBusinessIndex(businessId: string): Promise<void> {
  try {
    await elasticsearch.delete({
      index: BUSINESS_INDEX,
      id: businessId,
      refresh: true,
    });
  } catch (error) {
    console.error('Error deleting business from index:', error);
    throw error;
  }
}

// Search businesses
export async function searchBusinesses(
  options: SearchOptions
): Promise<SearchResult> {
  const {
    query,
    category,
    latitude,
    longitude,
    distance = '10km',
    minRating,
    maxPriceLevel,
    sortBy = 'relevance',
    from = 0,
    size = 20,
  } = options;

  const must: object[] = [];
  const filter: object[] = [];

  // Text search
  if (query) {
    must.push({
      multi_match: {
        query,
        fields: ['name^3', 'description', 'category_names', 'city'],
        fuzziness: 'AUTO',
      },
    });
  }

  // Category filter
  if (category) {
    filter.push({ term: { categories: category } });
  }

  // Geo distance filter
  if (latitude && longitude) {
    filter.push({
      geo_distance: {
        distance,
        location: {
          lat: parseFloat(String(latitude)),
          lon: parseFloat(String(longitude)),
        },
      },
    });
  }

  // Rating filter
  if (minRating) {
    filter.push({
      range: { rating: { gte: parseFloat(String(minRating)) } },
    });
  }

  // Price level filter
  if (maxPriceLevel) {
    filter.push({
      range: { price_level: { lte: parseInt(String(maxPriceLevel), 10) } },
    });
  }

  // Build sort
  const sort: object[] = [];
  switch (sortBy) {
    case 'rating':
      sort.push({ rating: 'desc' });
      break;
    case 'review_count':
      sort.push({ review_count: 'desc' });
      break;
    case 'distance':
      if (latitude && longitude) {
        sort.push({
          _geo_distance: {
            location: {
              lat: parseFloat(String(latitude)),
              lon: parseFloat(String(longitude)),
            },
            order: 'asc',
            unit: 'km',
          },
        });
      }
      break;
    default:
      sort.push({ _score: 'desc' });
      sort.push({ rating: 'desc' });
  }

  interface SearchBody {
    query: object;
    sort: object[];
    from: number;
    size: number;
    script_fields?: object;
  }

  const searchBody: SearchBody = {
    query: {
      bool: {
        must: must.length > 0 ? must : [{ match_all: {} }],
        filter,
      },
    },
    sort,
    from,
    size,
  };

  // Add distance calculation if location provided
  if (latitude && longitude) {
    searchBody.script_fields = {
      distance: {
        script: {
          source: "doc['location'].arcDistance(params.lat, params.lon) / 1000",
          params: {
            lat: parseFloat(String(latitude)),
            lon: parseFloat(String(longitude)),
          },
        },
      },
    };
  }

  try {
    const result = await elasticsearch.search<BusinessDocument>({
      index: BUSINESS_INDEX,
      ...searchBody,
    });

    const total =
      typeof result.hits.total === 'number'
        ? result.hits.total
        : (result.hits.total as SearchTotalHits).value;

    return {
      total,
      businesses: result.hits.hits.map(
        (hit) => ({
          ...(hit._source as BusinessDocument),
          score: hit._score,
          distance: (hit.fields?.distance as number[] | undefined)?.[0],
        })
      ),
    };
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

// Autocomplete suggestions
export async function autocompleteBusiness(
  prefix: string,
  _latitude?: number | null,
  _longitude?: number | null
): Promise<AutocompleteResult[]> {
  const suggest = {
    business_suggest: {
      prefix,
      completion: {
        field: 'name.suggest',
        size: 10,
        skip_duplicates: true,
      },
    },
  };

  try {
    const result = await elasticsearch.search<BusinessDocument>({
      index: BUSINESS_INDEX,
      suggest,
    });

    const suggestions = result.suggest?.business_suggest;
    if (!suggestions || !suggestions[0] || !('options' in suggestions[0])) {
      return [];
    }

    const options = suggestions[0].options as Array<{ _source?: BusinessDocument }>;
    return options.map(
      (opt) => ({
        id: opt._source?.id ?? '',
        name: opt._source?.name ?? '',
        city: opt._source?.city ?? '',
        rating: opt._source?.rating ?? 0,
      })
    );
  } catch (error) {
    console.error('Autocomplete error:', error);
    throw error;
  }
}
