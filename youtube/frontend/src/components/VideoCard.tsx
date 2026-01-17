import { Link } from '@tanstack/react-router';
import { Video } from '../types';
import { formatDuration, formatViewCount, timeAgo, getPlaceholderThumbnail, getAvatarUrl } from '../utils/format';

/**
 * Props for the VideoCard component.
 */
interface VideoCardProps {
  /** Video data to display */
  video: Video;
  /** Display layout: 'grid' for thumbnail-first, 'list' for horizontal */
  layout?: 'grid' | 'list';
}

/**
 * Video thumbnail card component.
 * Displays a video preview with thumbnail, title, channel info,
 * view count, and publish date. Supports both grid (vertical) and
 * list (horizontal) layouts for different page contexts.
 *
 * @param props.video - Video object containing metadata
 * @param props.layout - Display layout ('grid' or 'list')
 */
export default function VideoCard({ video, layout = 'grid' }: VideoCardProps) {
  const thumbnailUrl = video.thumbnailUrl || getPlaceholderThumbnail(video.title);

  if (layout === 'list') {
    return (
      <Link
        to="/watch/$videoId"
        params={{ videoId: video.id }}
        className="flex gap-2 p-1 hover:bg-yt-dark-hover rounded-lg group"
      >
        {/* Thumbnail */}
        <div className="video-thumbnail w-[168px] h-[94px] flex-shrink-0">
          <img
            src={thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
          />
          {video.duration && (
            <span className="video-duration">{formatDuration(video.duration)}</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="video-title text-sm leading-5 mb-1 group-hover:text-white">
            {video.title}
          </h3>
          {video.channel && (
            <p className="channel-name text-xs">{video.channel.name}</p>
          )}
          <p className="video-meta text-xs">
            {formatViewCount(video.viewCount)} <span className="mx-0.5">-</span> {timeAgo(video.publishedAt)}
          </p>
        </div>
      </Link>
    );
  }

  return (
    <div className="group">
      {/* Thumbnail */}
      <Link to="/watch/$videoId" params={{ videoId: video.id }}>
        <div className="video-thumbnail">
          <img
            src={thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
          />
          {video.duration && (
            <span className="video-duration">{formatDuration(video.duration)}</span>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="flex gap-3 mt-3">
        {/* Channel avatar */}
        {video.channel && (
          <Link
            to="/channel/$channelId"
            params={{ channelId: video.channel.id }}
            className="flex-shrink-0"
          >
            <img
              src={getAvatarUrl(video.channel.avatarUrl, video.channel.username)}
              alt={video.channel.name}
              className="w-9 h-9 rounded-full"
            />
          </Link>
        )}

        {/* Text info */}
        <div className="flex-1 min-w-0">
          <Link to="/watch/$videoId" params={{ videoId: video.id }}>
            <h3 className="video-title mb-1 group-hover:text-white">
              {video.title}
            </h3>
          </Link>

          {video.channel && (
            <Link
              to="/channel/$channelId"
              params={{ channelId: video.channel.id }}
              className="channel-name hover:text-white inline-flex items-center gap-1"
            >
              {video.channel.name}
              {/* Verified badge could go here */}
            </Link>
          )}

          <p className="video-meta">
            {formatViewCount(video.viewCount)} <span className="mx-0.5">-</span> {timeAgo(video.publishedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
