import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useVideoStore } from '../stores/videoStore';
import { useAuthStore } from '../stores/authStore';
import { StreamingInfo, Channel } from '../types';
import { api } from '../services/api';
import VideoPlayer from '../components/VideoPlayer';
import VideoCard from '../components/VideoCard';
import CommentSection from '../components/CommentSection';
import { formatViewCount, formatSubscriberCount, timeAgo, getAvatarUrl } from '../utils/format';

/**
 * Video watch page route configuration.
 * Dynamic route that accepts a videoId parameter.
 */
export const Route = createFileRoute('/watch/$videoId')({
  component: WatchPage,
});

/**
 * Video watch page component.
 * Displays the video player, video metadata (title, description, stats),
 * channel information with subscribe button, like/dislike actions,
 * comments section, and recommended videos sidebar. Handles video
 * progress tracking for watch history.
 */
function WatchPage() {
  const { videoId } = Route.useParams();
  const { user } = useAuthStore();
  const { currentVideo, recommendations, fetchVideo, fetchRecommendations, reactToVideo, recordView } = useVideoStore();

  const [streamingInfo, setStreamingInfo] = useState<StreamingInfo | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  useEffect(() => {
    fetchVideo(videoId);
    fetchStreamingInfo();
    fetchRecommendations();
    recordView(videoId);
  }, [videoId]);

  useEffect(() => {
    if (currentVideo?.channel) {
      fetchChannel(currentVideo.channel.id);
    }
  }, [currentVideo?.channel?.id]);

  const fetchStreamingInfo = async () => {
    try {
      const info = await api.get<StreamingInfo>(`/videos/${videoId}/stream`);
      setStreamingInfo(info);
    } catch (error) {
      console.error('Failed to fetch streaming info:', error);
    }
  };

  const fetchChannel = async (channelId: string) => {
    try {
      const ch = await api.get<Channel>(`/channels/${channelId}`);
      setChannel(ch);
      setIsSubscribed(ch.isSubscribed || false);
    } catch (error) {
      console.error('Failed to fetch channel:', error);
    }
  };

  const handleSubscribe = async () => {
    if (!user || !channel) return;

    try {
      if (isSubscribed) {
        await api.delete(`/channels/${channel.id}/subscribe`);
        setIsSubscribed(false);
      } else {
        await api.post(`/channels/${channel.id}/subscribe`);
        setIsSubscribed(true);
      }
    } catch (error) {
      console.error('Failed to toggle subscription:', error);
    }
  };

  const handleReact = (reaction: 'like' | 'dislike') => {
    if (!user) return;
    reactToVideo(videoId, reaction);
  };

  const handleProgress = async (position: number, duration: number) => {
    if (!user) return;
    try {
      await api.post(`/videos/${videoId}/progress`, { position, duration });
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  };

  if (!currentVideo) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
      </div>
    );
  }

  const isLiked = currentVideo.userReaction === 'like';
  const isDisliked = currentVideo.userReaction === 'dislike';

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 max-w-[1800px] mx-auto">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Video player */}
        {streamingInfo ? (
          <VideoPlayer
            streamingInfo={streamingInfo}
            onProgress={handleProgress}
            initialPosition={currentVideo.watchProgress?.position}
          />
        ) : (
          <div className="aspect-video bg-black rounded-xl flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
          </div>
        )}

        {/* Video info */}
        <div className="mt-3">
          <h1 className="text-xl font-semibold leading-7 mb-3">{currentVideo.title}</h1>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Channel info */}
            <div className="flex items-center gap-3">
              {channel && (
                <>
                  <img
                    src={getAvatarUrl(channel.avatarUrl, channel.username)}
                    alt={channel.name}
                    className="w-10 h-10 rounded-full"
                  />
                  <div className="mr-3">
                    <p className="font-medium text-sm leading-5">{channel.name}</p>
                    <p className="text-xs text-yt-text-secondary-dark">
                      {formatSubscriberCount(channel.subscriberCount)}
                    </p>
                  </div>
                  {user && user.id !== channel.id && (
                    <button
                      onClick={handleSubscribe}
                      className={`px-4 py-2 rounded-full font-medium text-sm transition-colors ${
                        isSubscribed
                          ? 'bg-yt-dark-hover text-white hover:bg-yt-dark-elevated'
                          : 'bg-white text-black hover:bg-gray-200'
                      }`}
                    >
                      {isSubscribed ? 'Subscribed' : 'Subscribe'}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Like/Dislike pill */}
              <div className="flex items-center bg-yt-dark-hover rounded-full">
                <button
                  onClick={() => handleReact('like')}
                  className={`flex items-center gap-2 pl-4 pr-3 py-2 rounded-l-full hover:bg-yt-dark-elevated transition-colors ${
                    isLiked ? 'text-white' : 'text-white'
                  }`}
                  title="I like this"
                >
                  {isLiked ? (
                    // Filled like icon
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 21v-2h2V9c0-1.1.9-2 2-2h9c.83 0 1.54.5 1.84 1.22l3.02 7.05c.09.23.14.47.14.73v2c0 1.1-.9 2-2 2h-6.31l.95 4.57.03.32c0 .41-.17.79-.44 1.06L12.17 27 5.59 20.41C5.22 20.05 5 19.55 5 19V9H3v12z"/>
                    </svg>
                  ) : (
                    // Outline like icon
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1l5.5 0c1.5-.02 2.87-1.1 3.27-2.55l1.38-5.03c.43-1.56-.58-3.19-2.18-3.7zM5 13v6H4v-6h1zm4 6V12l5.76-6.43c.18-.2.43-.31.69-.31.4 0 .74.28.86.66L14.6 10.4l-1.69 5.5h6.09c.78.25 1.11 1.14.73 1.84l-1.38 5.03c-.18.65-.76 1.11-1.44 1.12L9 24V19z"/>
                    </svg>
                  )}
                  <span className="font-medium text-sm">{currentVideo.likeCount}</span>
                </button>
                <div className="w-px h-6 bg-gray-600" />
                <button
                  onClick={() => handleReact('dislike')}
                  className={`flex items-center gap-2 pl-3 pr-4 py-2 rounded-r-full hover:bg-yt-dark-elevated transition-colors ${
                    isDisliked ? 'text-white' : 'text-white'
                  }`}
                  title="I dislike this"
                >
                  {isDisliked ? (
                    // Filled dislike icon
                    <svg className="w-6 h-6 rotate-180" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 21v-2h2V9c0-1.1.9-2 2-2h9c.83 0 1.54.5 1.84 1.22l3.02 7.05c.09.23.14.47.14.73v2c0 1.1-.9 2-2 2h-6.31l.95 4.57.03.32c0 .41-.17.79-.44 1.06L12.17 27 5.59 20.41C5.22 20.05 5 19.55 5 19V9H3v12z"/>
                    </svg>
                  ) : (
                    // Outline dislike icon
                    <svg className="w-6 h-6 rotate-180" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1l5.5 0c1.5-.02 2.87-1.1 3.27-2.55l1.38-5.03c.43-1.56-.58-3.19-2.18-3.7zM5 13v6H4v-6h1zm4 6V12l5.76-6.43c.18-.2.43-.31.69-.31.4 0 .74.28.86.66L14.6 10.4l-1.69 5.5h6.09c.78.25 1.11 1.14.73 1.84l-1.38 5.03c-.18.65-.76 1.11-1.44 1.12L9 24V19z"/>
                    </svg>
                  )}
                </button>
              </div>

              {/* Share button */}
              <button className="flex items-center gap-2 px-4 py-2 bg-yt-dark-hover rounded-full hover:bg-yt-dark-elevated transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-9-8-9z"/>
                </svg>
                <span className="font-medium text-sm">Share</span>
              </button>

              {/* Download button */}
              <button className="flex items-center gap-2 px-4 py-2 bg-yt-dark-hover rounded-full hover:bg-yt-dark-elevated transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5z"/>
                </svg>
                <span className="font-medium text-sm">Download</span>
              </button>

              {/* More button */}
              <button className="p-2 bg-yt-dark-hover rounded-full hover:bg-yt-dark-elevated transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7.5 12c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zm4.5-1.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm6 0c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Description box */}
          <div
            className={`mt-3 bg-yt-dark-hover rounded-xl p-3 cursor-pointer hover:bg-yt-dark-elevated transition-colors ${
              isDescriptionExpanded ? '' : ''
            }`}
            onClick={() => !isDescriptionExpanded && setIsDescriptionExpanded(true)}
          >
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <span>{formatViewCount(currentVideo.viewCount)}</span>
              <span>{timeAgo(currentVideo.publishedAt)}</span>
              {currentVideo.tags && currentVideo.tags.length > 0 && (
                <span className="text-yt-blue-light">#{currentVideo.tags[0]}</span>
              )}
            </div>
            <div className={`${isDescriptionExpanded ? '' : 'line-clamp-2'}`}>
              <p className="whitespace-pre-wrap text-sm">{currentVideo.description || 'No description'}</p>
            </div>
            {currentVideo.description && currentVideo.description.length > 100 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDescriptionExpanded(!isDescriptionExpanded);
                }}
                className="text-sm font-medium mt-3 hover:underline"
              >
                {isDescriptionExpanded ? 'Show less' : '...more'}
              </button>
            )}
          </div>

          {/* Comments */}
          <CommentSection videoId={videoId} commentCount={currentVideo.commentCount} />
        </div>
      </div>

      {/* Sidebar - Recommendations */}
      <div className="w-full lg:w-[402px] flex-shrink-0">
        <div className="space-y-2">
          {recommendations
            .filter((v) => v.id !== videoId)
            .slice(0, 20)
            .map((video) => (
              <VideoCard key={video.id} video={video} layout="list" />
            ))}
        </div>
      </div>
    </div>
  );
}
