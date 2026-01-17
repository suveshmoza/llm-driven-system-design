import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Timeline } from '../../components/Timeline';
import { useTimelineStore } from '../../stores/timelineStore';

export const Route = createFileRoute('/_layout/explore')({
  component: ExplorePage,
});

function ExplorePage() {
  const { tweets, isLoading, error, nextCursor, fetchExploreTimeline, loadMore } = useTimelineStore();

  useEffect(() => {
    fetchExploreTimeline();
  }, [fetchExploreTimeline]);

  return (
    <div>
      <header className="sticky top-0 bg-white/85 backdrop-blur-md border-b border-twitter-border z-10">
        <h1 className="text-xl font-bold px-4 py-3 text-twitter-dark">Explore</h1>
      </header>

      <Timeline
        tweets={tweets}
        isLoading={isLoading}
        error={error}
        onLoadMore={loadMore}
        hasMore={!!nextCursor}
        emptyMessage="No tweets to explore yet. Be the first to tweet!"
      />
    </div>
  );
}
