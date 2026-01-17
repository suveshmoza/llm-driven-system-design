import { createFileRoute, useParams, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Timeline } from '../../components/Timeline';
import { useTimelineStore } from '../../stores/timelineStore';
import { useAuthStore } from '../../stores/authStore';
import { usersApi } from '../../services/api';
import { User } from '../../types';
import { formatNumber } from '../../utils/format';

export const Route = createFileRoute('/_layout/$username')({
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = useParams({ from: '/_layout/$username' });
  const { user: currentUser } = useAuthStore();
  const { tweets, isLoading, error, nextCursor, fetchUserTimeline, loadMore } = useTimelineStore();

  const [profile, setProfile] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      setProfileLoading(true);
      setProfileError(null);
      try {
        const { user } = await usersApi.getUser(username);
        setProfile(user);
        setIsFollowing(user.isFollowing || false);
      } catch (err) {
        setProfileError((err as Error).message);
      } finally {
        setProfileLoading(false);
      }
    };

    fetchProfile();
    fetchUserTimeline(username);
  }, [username, fetchUserTimeline]);

  const handleFollow = async () => {
    if (!profile || !currentUser) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        await usersApi.unfollow(profile.id);
        setIsFollowing(false);
        setProfile((p) => p ? { ...p, followerCount: p.followerCount - 1 } : p);
      } else {
        await usersApi.follow(profile.id);
        setIsFollowing(true);
        setProfile((p) => p ? { ...p, followerCount: p.followerCount + 1 } : p);
      }
    } catch (err) {
      console.error('Follow error:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block w-8 h-8 border-4 border-twitter-blue border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="p-8 text-center">
        <p className="text-twitter-like text-[15px]">{profileError || 'User not found'}</p>
      </div>
    );
  }

  const isOwnProfile = currentUser?.username === profile.username;

  return (
    <div>
      <header className="sticky top-0 bg-white/85 backdrop-blur-md border-b border-twitter-border z-10">
        <div className="flex items-center gap-6 px-4 py-1">
          <Link to="/" className="p-2 -ml-2 hover:bg-twitter-dark/10 rounded-full transition-colors">
            <svg className="w-5 h-5 text-twitter-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-twitter-dark leading-6">{profile.displayName}</h1>
            <p className="text-[13px] text-twitter-gray">{formatNumber(profile.tweetCount)} tweets</p>
          </div>
        </div>
      </header>

      {/* Profile banner */}
      <div className="h-[200px] bg-twitter-blue"></div>

      {/* Profile info */}
      <div className="relative px-4 pb-4 border-b border-twitter-border">
        {/* Avatar */}
        <div className="absolute -top-[68px] w-[134px] h-[134px] rounded-full border-4 border-white bg-twitter-blue flex items-center justify-center text-white text-5xl font-bold">
          {profile.displayName.charAt(0).toUpperCase()}
        </div>

        {/* Follow button */}
        <div className="flex justify-end pt-3 min-h-[68px]">
          {!isOwnProfile && currentUser && (
            <button
              onClick={handleFollow}
              disabled={followLoading}
              className={`px-5 py-2 rounded-full font-bold text-[15px] transition-colors ${
                isFollowing
                  ? 'border border-twitter-border text-twitter-dark hover:border-twitter-like hover:text-twitter-like hover:bg-twitter-like/10'
                  : 'bg-twitter-dark text-white hover:bg-twitter-dark/90'
              }`}
            >
              {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
          {isOwnProfile && (
            <button className="px-5 py-2 rounded-full font-bold text-[15px] border border-twitter-border text-twitter-dark hover:bg-twitter-dark/5 transition-colors">
              Edit profile
            </button>
          )}
        </div>

        {/* User info */}
        <div className="mt-1">
          <h2 className="text-xl font-bold text-twitter-dark">{profile.displayName}</h2>
          <p className="text-twitter-gray text-[15px]">@{profile.username}</p>

          {profile.bio && (
            <p className="mt-3 text-[15px] text-twitter-dark">{profile.bio}</p>
          )}

          <div className="flex items-center gap-5 mt-3 text-[15px]">
            <Link to={`/${username}/following`} className="hover:underline">
              <span className="font-bold text-twitter-dark">{formatNumber(profile.followingCount)}</span>{' '}
              <span className="text-twitter-gray">Following</span>
            </Link>
            <Link to={`/${username}/followers`} className="hover:underline">
              <span className="font-bold text-twitter-dark">{formatNumber(profile.followerCount)}</span>{' '}
              <span className="text-twitter-gray">Followers</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-twitter-border">
        <button className="flex-1 py-4 text-center font-bold text-[15px] text-twitter-dark relative hover:bg-twitter-dark/5 transition-colors">
          Tweets
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-1 bg-twitter-blue rounded-full"></div>
        </button>
        <button className="flex-1 py-4 text-center text-[15px] text-twitter-gray hover:bg-twitter-dark/5 transition-colors">
          Replies
        </button>
        <button className="flex-1 py-4 text-center text-[15px] text-twitter-gray hover:bg-twitter-dark/5 transition-colors">
          Likes
        </button>
      </div>

      <Timeline
        tweets={tweets}
        isLoading={isLoading}
        error={error}
        onLoadMore={loadMore}
        hasMore={!!nextCursor}
        emptyMessage={`@${profile.username} hasn't tweeted yet`}
      />
    </div>
  );
}
