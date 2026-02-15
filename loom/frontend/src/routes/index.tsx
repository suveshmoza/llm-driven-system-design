import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useVideoStore } from '../stores/videoStore';
import { VideoGrid } from '../components/VideoGrid';
import { VideoFilters } from '../components/VideoFilters';
import { FolderTree } from '../components/FolderTree';
import { EmptyState } from '../components/EmptyState';

function LibraryPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const videos = useVideoStore((s) => s.videos);
  const total = useVideoStore((s) => s.total);
  const videosLoading = useVideoStore((s) => s.loading);
  const fetchVideos = useVideoStore((s) => s.fetchVideos);
  const deleteVideo = useVideoStore((s) => s.deleteVideo);

  const [search, setSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      fetchVideos({ search: search || undefined, folderId: selectedFolderId });
    }
  }, [user, search, selectedFolderId, fetchVideos]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-loom-secondary">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-loom-text">My Library</h1>
          <p className="text-loom-secondary mt-1">{total} video{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate({ to: '/record' })}
          className="px-4 py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover transition-colors font-medium flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-loom-accent" />
          Record Video
        </button>
      </div>

      <div className="flex gap-6">
        <div className="w-56 flex-shrink-0">
          <FolderTree
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
          />
        </div>

        <div className="flex-1">
          <VideoFilters search={search} onSearchChange={setSearch} />

          {videosLoading ? (
            <div className="text-center py-12 text-loom-secondary">Loading videos...</div>
          ) : videos.length === 0 ? (
            <EmptyState
              title={search ? 'No videos found' : 'No videos yet'}
              description={search ? 'Try a different search term' : 'Record your first video to get started'}
              actionLabel={search ? undefined : 'Record Video'}
              onAction={search ? undefined : () => navigate({ to: '/record' })}
            />
          ) : (
            <VideoGrid videos={videos} onDelete={deleteVideo} />
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: LibraryPage,
});
