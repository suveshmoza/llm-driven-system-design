import { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * @description Extended request interface for file upload endpoints using Multer.
 * Includes the optional file property populated by Multer middleware.
 */
export interface MulterRequest extends AuthenticatedRequest {
  /** The uploaded file object, populated by Multer when a file is present */
  file?: Express.Multer.File;
}

/**
 * @description Request body for activity upload endpoint.
 * All fields are optional as defaults are applied.
 */
export interface UploadBody {
  /** Activity type (e.g., 'run', 'ride', 'swim'). Defaults to 'run' */
  type?: string;
  /** Custom name for the activity. Falls back to GPX name or generated name */
  name?: string;
  /** Optional description text for the activity */
  description?: string;
  /** Privacy setting: 'public', 'followers', or 'private'. Defaults to 'followers' */
  privacy?: string;
}

/**
 * @description Request body for simulated activity creation.
 * Generates synthetic GPS data for testing purposes.
 */
export interface SimulateBody {
  /** Activity type (e.g., 'run', 'ride'). Defaults to 'run' */
  type?: string;
  /** Custom name for the activity. Defaults to 'Simulated [Type]' */
  name?: string;
  /** Starting latitude. Defaults to 37.7749 (San Francisco) */
  startLat?: number;
  /** Starting longitude. Defaults to -122.4194 (San Francisco) */
  startLng?: number;
  /** Number of GPS points to generate. Defaults to 100 */
  numPoints?: number;
}

/**
 * @description Database row representation of an activity.
 * Maps directly to the activities table with optional joined user fields.
 */
export interface ActivityRow {
  /** Unique activity identifier (UUID) */
  id: string;
  /** ID of the user who created the activity */
  user_id: string;
  /** Activity type (e.g., 'run', 'ride', 'swim') */
  type: string;
  /** Display name of the activity */
  name: string;
  /** Optional description text */
  description: string | null;
  /** When the activity started */
  start_time: Date;
  /** Total elapsed time in seconds */
  elapsed_time: number;
  /** Time spent moving in seconds */
  moving_time: number;
  /** Total distance in meters */
  distance: number;
  /** Total elevation gain in meters */
  elevation_gain: number;
  /** Average speed in m/s */
  avg_speed: number;
  /** Maximum speed in m/s */
  max_speed: number;
  /** Encoded polyline string for route display */
  polyline: string;
  /** Starting point latitude */
  start_lat: number;
  /** Starting point longitude */
  start_lng: number;
  /** Ending point latitude */
  end_lat: number;
  /** Ending point longitude */
  end_lng: number;
  /** Privacy setting: 'public', 'followers', or 'private' */
  privacy: string;
  /** Number of kudos received */
  kudos_count: number;
  /** Number of comments */
  comment_count: number;
  /** When the activity was created in the database */
  created_at: Date;
  /** Username of the activity owner (from joined users table) */
  username?: string;
  /** Profile photo URL of the activity owner (from joined users table) */
  profile_photo?: string | null;
}

/**
 * @description Database row representation of a segment effort.
 * Includes joined segment data for display purposes.
 */
export interface SegmentEffortRow {
  /** Unique segment effort identifier (UUID) */
  id: string;
  /** ID of the matched segment */
  segment_id: string;
  /** ID of the activity containing this effort */
  activity_id: string;
  /** Total elapsed time for this segment in seconds */
  elapsed_time: number;
  /** Moving time for this segment in seconds */
  moving_time: number;
  /** GPS point index where this segment starts */
  start_index: number;
  /** GPS point index where this segment ends */
  end_index: number;
  /** Name of the segment (from joined segments table) */
  segment_name: string;
  /** Distance of the segment in meters (from joined segments table) */
  segment_distance: number;
}

/**
 * @description Database row representation of a comment with user data.
 * Includes joined user information for display.
 */
export interface CommentRow {
  /** Unique comment identifier (UUID) */
  id: string;
  /** Comment text content */
  content: string;
  /** When the comment was created */
  created_at: Date;
  /** ID of the user who wrote the comment */
  user_id: string;
  /** Username of the commenter (from joined users table) */
  username: string;
  /** Profile photo URL of the commenter (from joined users table) */
  profile_photo: string | null;
}

/**
 * @description Database row representation of a GPS point.
 * Contains location and optional sensor data.
 */
export interface GpsPointRow {
  /** Zero-based index of this point in the activity */
  point_index: number;
  /** Timestamp when this point was recorded */
  timestamp: Date;
  /** Latitude in degrees */
  latitude: number;
  /** Longitude in degrees */
  longitude: number;
  /** Altitude in meters above sea level */
  altitude: number | null;
  /** Instantaneous speed in m/s */
  speed: number | null;
  /** Heart rate in beats per minute */
  heart_rate: number | null;
  /** Cadence (steps/revolutions per minute) */
  cadence: number | null;
  /** Power output in watts */
  power: number | null;
}
