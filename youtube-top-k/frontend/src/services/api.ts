import type { Video, TrendingResponse, TrendingAllResponse, StatsResponse } from '../types';

const API_BASE = '/api';

/** Fetches trending videos for the specified category from the backend. */
export async function fetchTrending(category: string = 'all'): Promise<TrendingResponse> {
  const response = await fetch(`${API_BASE}/trending?category=${category}`);
  if (!response.ok) {
    throw new Error('Failed to fetch trending videos');
  }
  return response.json();
}

/** Fetches trending videos across all categories at once. */
export async function fetchAllTrending(): Promise<TrendingAllResponse> {
  const response = await fetch(`${API_BASE}/trending/all`);
  if (!response.ok) {
    throw new Error('Failed to fetch all trending videos');
  }
  return response.json();
}

/** Fetches the list of available video categories. */
export async function fetchCategories(): Promise<{ categories: string[] }> {
  const response = await fetch(`${API_BASE}/trending/categories`);
  if (!response.ok) {
    throw new Error('Failed to fetch categories');
  }
  return response.json();
}

/** Fetches aggregated system statistics including total views and connected clients. */
export async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch(`${API_BASE}/trending/stats`);
  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }
  return response.json();
}

/** Records a single view for a video and returns the updated total. */
export async function recordView(videoId: string): Promise<{ success: boolean; totalViews: number }> {
  const response = await fetch(`${API_BASE}/videos/${videoId}/view`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to record view');
  }
  return response.json();
}

/** Fetches paginated video list with optional category filtering. */
export async function fetchVideos(
  page: number = 1,
  limit: number = 20,
  category?: string
): Promise<{ videos: Video[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (category && category !== 'all') {
    params.set('category', category);
  }
  const response = await fetch(`${API_BASE}/videos?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch videos');
  }
  return response.json();
}

/** Triggers a manual refresh of the trending video rankings. */
export async function refreshTrending(): Promise<void> {
  const response = await fetch(`${API_BASE}/trending/refresh`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to refresh trending');
  }
}

/** Records multiple views in a single batch request for load simulation. */
export async function batchRecordViews(views: { videoId: string; count: number }[]): Promise<void> {
  const response = await fetch(`${API_BASE}/videos/batch-view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ views }),
  });
  if (!response.ok) {
    throw new Error('Failed to batch record views');
  }
}
