import type { ExcalidrawElement, Point } from '../types';

/**
 * Get the bounding box of an element.
 */
/** Calculates the axis-aligned bounding box for a drawing element. */
export const getBoundingBox = (element: ExcalidrawElement): { x: number; y: number; width: number; height: number } => {
  if (element.type === 'freehand' && element.points && element.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of element.points) {
      const px = element.x + p.x;
      const py = element.y + p.y;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
};

/**
 * Test if a point is inside a rectangle.
 */
/** Tests if a point lies inside a rectangle. */
export const pointInRect = (px: number, py: number, x: number, y: number, w: number, h: number): boolean => {
  const left = Math.min(x, x + w);
  const right = Math.max(x, x + w);
  const top = Math.min(y, y + h);
  const bottom = Math.max(y, y + h);
  return px >= left && px <= right && py >= top && py <= bottom;
};

/**
 * Test if a point is inside an ellipse.
 */
/** Tests if a point lies inside an ellipse. */
export const pointInEllipse = (px: number, py: number, cx: number, cy: number, rx: number, ry: number): boolean => {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

/**
 * Test if a point is inside a diamond (rotated square).
 */
/** Tests if a point lies inside a diamond shape. */
export const pointInDiamond = (px: number, py: number, x: number, y: number, w: number, h: number): boolean => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.abs(px - cx) / (w / 2);
  const dy = Math.abs(py - cy) / (h / 2);
  return dx + dy <= 1;
};

/**
 * Distance from a point to a line segment.
 */
/** Calculates the perpendicular distance from a point to a line segment. */
export const distanceToLine = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const nearX = x1 + t * dx;
  const nearY = y1 + t * dy;

  return Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));
};

/**
 * Test if a point is near a freehand path.
 */
export const pointNearPath = (px: number, py: number, points: Point[], baseX: number, baseY: number, threshold: number = 8): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = baseX + points[i].x;
    const y1 = baseY + points[i].y;
    const x2 = baseX + points[i + 1].x;
    const y2 = baseY + points[i + 1].y;

    if (distanceToLine(px, py, x1, y1, x2, y2) < threshold) {
      return true;
    }
  }
  return false;
};

/**
 * Hit test: determine which element is at a given point.
 * Returns the topmost (last drawn) element at that point.
 */
export const hitTest = (x: number, y: number, elements: ExcalidrawElement[], threshold: number = 8): ExcalidrawElement | null => {
  // Iterate in reverse to get topmost element first
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted) continue;

    switch (el.type) {
      case 'rectangle':
        if (pointInRect(x, y, el.x, el.y, el.width, el.height)) return el;
        break;

      case 'ellipse': {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        if (pointInEllipse(x, y, cx, cy, Math.abs(el.width) / 2, Math.abs(el.height) / 2)) return el;
        break;
      }

      case 'diamond':
        if (pointInDiamond(x, y, el.x, el.y, el.width, el.height)) return el;
        break;

      case 'line':
      case 'arrow':
        if (el.points && el.points.length >= 2) {
          if (pointNearPath(x, y, el.points, el.x, el.y, threshold)) return el;
        } else {
          // Simple two-point line
          if (distanceToLine(x, y, el.x, el.y, el.x + el.width, el.y + el.height) < threshold) return el;
        }
        break;

      case 'freehand':
        if (el.points && pointNearPath(x, y, el.points, el.x, el.y, threshold)) return el;
        break;

      case 'text': {
        const textW = el.width || 100;
        const textH = el.height || (el.fontSize || 16) * 1.5;
        if (pointInRect(x, y, el.x, el.y, textW, textH)) return el;
        break;
      }
    }
  }

  return null;
};

/**
 * Generate a unique element ID.
 */
export const generateId = (): string => {
  return `el-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};
