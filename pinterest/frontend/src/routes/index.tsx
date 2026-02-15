import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import MasonryGrid from '../components/MasonryGrid';
import SaveToBoard from '../components/SaveToBoard';
import { useAuthStore } from '../stores/authStore';
import { usePinStore } from '../stores/pinStore';
import * as api from '../services/api';
import type { Pin } from '../types';

interface SearchParams {
  q?: string;
}

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || undefined,
  }),
});

function HomePage() {
  const { q } = Route.useSearch();
  const { user } = useAuthStore();
  const { feedPins, feedCursor, feedLoading, loadFeed, loadDiscoverFeed, clearFeed } = usePinStore();
  const [searchResults, setSearchResults] = useState<Pin[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [savePinId, setSavePinId] = useState<string | null>(null);

  // Search mode
  useEffect(() => {
    if (q && q.length >= 2) {
      setSearchLoading(true);
      api
        .searchPins(q)
        .then(({ pins }) => setSearchResults(pins))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    } else {
      setSearchResults([]);
    }
  }, [q]);

  // Feed mode
  useEffect(() => {
    if (!q) {
      clearFeed();
      if (user) {
        loadFeed(true);
      } else {
        loadDiscoverFeed(true);
      }
    }
  }, [q, user, loadFeed, loadDiscoverFeed, clearFeed]);

  const handleLoadMore = useCallback(() => {
    if (user) {
      loadFeed();
    } else {
      loadDiscoverFeed();
    }
  }, [user, loadFeed, loadDiscoverFeed]);

  const handleSavePin = useCallback((pinId: string) => {
    setSavePinId(pinId);
  }, []);

  const isSearchMode = q && q.length >= 2;
  const displayPins = isSearchMode ? searchResults : feedPins;
  const isLoading = isSearchMode ? searchLoading : feedLoading;
  const hasMore = !isSearchMode && feedCursor !== null;

  return (
    <div>
      {isSearchMode && (
        <div className="px-4 py-4 max-w-screen-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-1">Results for "{q}"</h2>
          <p className="text-text-secondary text-sm mb-4">
            {displayPins.length} {displayPins.length === 1 ? 'pin' : 'pins'} found
          </p>
        </div>
      )}

      <MasonryGrid
        pins={displayPins}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        isLoading={isLoading}
        onSavePin={user ? handleSavePin : undefined}
      />

      {/* Save to board modal */}
      {savePinId && (
        <SaveToBoard
          pinId={savePinId}
          isOpen={!!savePinId}
          onClose={() => setSavePinId(null)}
        />
      )}
    </div>
  );
}
