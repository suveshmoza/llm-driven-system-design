/**
 * Picsum.photos URL helpers
 */

// Get image URL by ID with specific dimensions
export const getImageUrl = (id: number, width: number, height: number): string =>
  `https://picsum.photos/id/${id}/${width}/${height}`

// Get random image URL
export const getRandomImageUrl = (width: number, height: number, seed?: number): string =>
  seed
    ? `https://picsum.photos/seed/${seed}/${width}/${height}`
    : `https://picsum.photos/${width}/${height}`

// Pre-generate list of reliable image IDs (10-60 range is stable)
export const imageIds: number[] = Array.from({ length: 50 }, (_, i) => i + 10)

// Get image info URL (returns JSON with author, download_url, etc.)
export const getImageInfoUrl = (id: number): string =>
  `https://picsum.photos/id/${id}/info`

// Image aspect ratios for masonry effect
export const getAspectRatio = (id: number): number => {
  // Deterministic but varied heights based on ID
  const ratios = [0.75, 1, 1.25, 1.5, 0.8, 1.2]
  return ratios[id % ratios.length]
}

// Get height for masonry layout based on width and aspect ratio
export const getMasonryHeight = (id: number, width: number): number => {
  return Math.round(width * getAspectRatio(id))
}
