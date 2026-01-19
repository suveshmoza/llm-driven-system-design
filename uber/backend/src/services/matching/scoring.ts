import type { NearbyDriver, ScoredDriver } from '../../types/index.js';
import { estimateTravelTime } from '../../utils/geo.js';

/**
 * Score and rank drivers based on ETA and rating.
 * Lower ETA is better (inverted and normalized).
 * Higher rating is better.
 * Weighted combination: 60% ETA, 40% rating.
 */
export function scoreDrivers(
  drivers: NearbyDriver[],
  _pickupLat: number,
  _pickupLng: number
): ScoredDriver[] {
  const scored = drivers.map((driver) => {
    const eta = estimateTravelTime(driver.distanceKm);

    // Lower ETA is better (invert and normalize)
    const etaScore = Math.max(0, 1 - eta / 30);

    // Higher rating is better
    const ratingScore = (driver.rating - 3) / 2;

    // Weighted combination
    const score = 0.6 * etaScore + 0.4 * ratingScore;

    return {
      ...driver,
      eta,
      score,
    };
  });

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}
