import type { Point } from '../types';

/**
 * Ramer-Douglas-Peucker algorithm for path simplification.
 * Reduces the number of points in a freehand path while
 * preserving its overall shape.
 */

const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      (point.x - lineStart.x) * (point.x - lineStart.x) +
      (point.y - lineStart.y) * (point.y - lineStart.y)
    );
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  const nearX = lineStart.x + t * dx;
  const nearY = lineStart.y + t * dy;

  return Math.sqrt(
    (point.x - nearX) * (point.x - nearX) +
    (point.y - nearY) * (point.y - nearY)
  );
};

/**
 * Simplify a path using Ramer-Douglas-Peucker algorithm.
 * @param points - Array of points to simplify
 * @param epsilon - Maximum distance threshold (higher = more simplification)
 * @returns Simplified array of points
 */
/** Reduces the number of points in a freehand path using the Ramer-Douglas-Peucker algorithm. */
export const simplifyPath = (points: Point[], epsilon: number = 2): Point[] => {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line
  let maxDistance = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], start, end);
    if (d > maxDistance) {
      maxDistance = d;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPath(points.slice(maxIndex), epsilon);

    // Concatenate results (remove duplicate point at junction)
    return [...left.slice(0, -1), ...right];
  }

  // Otherwise, just keep endpoints
  return [start, end];
};

export default simplifyPath;
