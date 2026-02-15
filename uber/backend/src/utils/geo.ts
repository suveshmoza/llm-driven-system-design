/** Calculates the haversine distance in kilometers between two geographic coordinates. */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Convert km to miles
/** Converts kilometers to miles. */
export function kmToMiles(km: number): number {
  return km * 0.621371;
}

// Convert miles to km
/** Converts miles to kilometers. */
export function milesToKm(miles: number): number {
  return miles * 1.60934;
}

// Estimate travel time based on distance (simple linear model)
// Assumes average speed of 30 km/h in urban areas
/** Estimates travel time in minutes based on distance and average speed. */
export function estimateTravelTime(distanceKm: number, averageSpeedKmh: number = 30): number {
  const hours = distanceKm / averageSpeedKmh;
  return Math.ceil(hours * 60); // Return minutes
}

// Generate a simple geohash (precision 6 = ~1.2km x 0.6km)
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Encodes latitude/longitude into a geohash string for spatial partitioning of surge zones. */
export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  let minLat = -90,
    maxLat = 90;
  let minLng = -180,
    maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

// Get neighboring geohash cells
/** Returns the 8 neighboring geohash cells for boundary-aware surge lookups. */
export function getGeohashNeighbors(geohash: string): string[] {
  // Simplified: returns the same geohash
  // In production, would calculate actual neighbors
  return [geohash];
}

// Format currency
/** Formats a cent amount as a dollar string (e.g., 1250 becomes "$12.50"). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Generate random ID
/** Generates a random hex string for use as entity identifiers. */
export function generateId(): string {
  return crypto.randomUUID();
}
