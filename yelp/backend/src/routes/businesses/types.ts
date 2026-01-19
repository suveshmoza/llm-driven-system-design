// Database row interfaces
export interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  website: string | null;
  email: string | null;
  price_level: number | null;
  rating: number;
  review_count: number;
  photo_count: number;
  is_claimed: boolean;
  is_verified: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  categories?: string[] | null;
  category_names?: string[] | null;
  photo_url?: string | null;
  distance_km?: number;
  hours?: BusinessHour[];
  photos?: BusinessPhoto[];
  owner_name?: string | null;
  is_owner?: boolean;
}

export interface BusinessHour {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export interface BusinessPhoto {
  id: string;
  url: string;
  caption: string | null;
  is_primary: boolean;
}

export interface OwnerCheckRow {
  owner_id: string | null;
}

export interface ClaimCheckRow {
  is_claimed: boolean;
  owner_id: string | null;
}

export interface CountRow {
  count: string;
}

export interface ReviewWithUser {
  id: string;
  business_id: string;
  user_id: string;
  rating: number;
  text: string;
  helpful_count: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_avatar: string | null;
  user_review_count: number;
  response_text: string | null;
  response_created_at: string | null;
  photos: string[] | null;
}

export interface CategoryRow {
  slug: string;
  name: string;
}

// Request body interfaces
export interface CreateBusinessBody {
  name: string;
  description?: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  country?: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  email?: string;
  price_level?: number;
  categories?: string[];
}

export interface UpdateBusinessBody {
  name?: string;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  phone?: string;
  website?: string;
  email?: string;
  price_level?: number;
  latitude?: number;
  longitude?: number;
  categories?: string[];
}

export interface AddHoursBody {
  hours: Array<{
    day_of_week: number;
    open_time: string;
    close_time: string;
    is_closed?: boolean;
  }>;
}

export interface AddPhotoBody {
  url: string;
  caption?: string;
  is_primary?: boolean;
}

// Helper to generate slug
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
