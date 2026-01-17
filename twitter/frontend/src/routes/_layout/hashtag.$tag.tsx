import { createFileRoute, useParams, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Timeline } from '../../components/Timeline';
import { useTimelineStore } from '../../stores/timelineStore';

export const Route = createFileRoute('/_layout/hashtag/$tag')({
  component: HashtagPage,
});

function HashtagPage() {
  const { tag } = useParams({ from: '/_layout/hashtag/$tag' });
  const { tweets, isLoading, error, nextCursor, fetchHashtagTimeline, loadMore } = useTimelineStore();

  useEffect(() => {
    fetchHashtagTimeline(tag);
  }, [tag, fetchHashtagTimeline]);

  return (
    <div>
      <header className="sticky top-0 bg-white/85 backdrop-blur-md border-b border-twitter-border z-10">
        <div className="flex items-center gap-6 px-4 py-3">
          <Link to="/" className="p-2 -ml-2 hover:bg-twitter-dark/10 rounded-full transition-colors">
            <svg className="w-5 h-5 text-twitter-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-twitter-dark">#{tag}</h1>
        </div>
      </header>

      <Timeline
        tweets={tweets}
        isLoading={isLoading}
        error={error}
        onLoadMore={loadMore}
        hasMore={!!nextCursor}
        emptyMessage={`No tweets with #${tag} yet`}
      />
    </div>
  );
}
