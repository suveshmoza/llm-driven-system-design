import { AuthenticatedRequest } from '../../middleware/auth.js';

// Request types
export interface MulterRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
}

export interface UploadBody {
  type?: string;
  name?: string;
  description?: string;
  privacy?: string;
}

export interface SimulateBody {
  type?: string;
  name?: string;
  startLat?: number;
  startLng?: number;
  numPoints?: number;
}

// Database row types
export interface ActivityRow {
  id: string;
  user_id: string;
  type: string;
  name: string;
  description: string | null;
  start_time: Date;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  elevation_gain: number;
  avg_speed: number;
  max_speed: number;
  polyline: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  privacy: string;
  kudos_count: number;
  comment_count: number;
  created_at: Date;
  username?: string;
  profile_photo?: string | null;
}

export interface SegmentEffortRow {
  id: string;
  segment_id: string;
  activity_id: string;
  elapsed_time: number;
  moving_time: number;
  start_index: number;
  end_index: number;
  segment_name: string;
  segment_distance: number;
}

export interface CommentRow {
  id: string;
  content: string;
  created_at: Date;
  user_id: string;
  username: string;
  profile_photo: string | null;
}

export interface GpsPointRow {
  point_index: number;
  timestamp: Date;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heart_rate: number | null;
  cadence: number | null;
  power: number | null;
}
