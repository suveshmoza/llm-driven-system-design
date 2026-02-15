import { useMemo } from 'react';
import type { Pin } from '../types';

export interface MasonryItem {
  pin: Pin;
  column: number;
  top: number;
  height: number;
}

const PIN_GAP = 16;
const PIN_PADDING = 40; // space for title/info below image

/**
 * Distributes pins into columns for masonry layout.
 * For each pin, finds the shortest column and places the pin there.
 * Returns items with their column index and absolute top position.
 */
export function useMasonryLayout(
  pins: Pin[],
  columnCount: number,
  columnWidth: number,
): { items: MasonryItem[]; totalHeight: number } {
  return useMemo(() => {
    if (pins.length === 0 || columnCount === 0) {
      return { items: [], totalHeight: 0 };
    }

    const columnHeights = new Array(columnCount).fill(0) as number[];
    const items: MasonryItem[] = [];

    for (const pin of pins) {
      // Find shortest column
      let shortestColumn = 0;
      let minHeight = columnHeights[0];
      for (let i = 1; i < columnCount; i++) {
        if (columnHeights[i] < minHeight) {
          minHeight = columnHeights[i];
          shortestColumn = i;
        }
      }

      // Calculate pin height based on aspect ratio
      const aspectRatio = pin.aspectRatio || 1;
      const imageHeight = columnWidth * aspectRatio;
      const totalPinHeight = imageHeight + PIN_PADDING;

      const top = columnHeights[shortestColumn];

      items.push({
        pin,
        column: shortestColumn,
        top,
        height: totalPinHeight,
      });

      columnHeights[shortestColumn] += totalPinHeight + PIN_GAP;
    }

    const totalHeight = Math.max(...columnHeights);

    return { items, totalHeight };
  }, [pins, columnCount, columnWidth]);
}
