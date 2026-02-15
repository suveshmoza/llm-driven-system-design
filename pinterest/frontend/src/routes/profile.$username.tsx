import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import MasonryGrid from '../components/MasonryGrid';
import BoardGrid from '../components/BoardGrid';
import UserAvatar from '../components/UserAvatar';
import { formatNumber } from '../utils/format';
import type { User, Pin, Board } from '../types';

export const Route = createFileRoute('/profile/$username')({
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();
  const { user: currentUser } = useAuthStore();
  const [profile, setProfile] = useState<User | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'created' | 'saved'>('created');
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getUser(username),
      api.getUserPins(username),
      api.getUserBoards(username),
    ])
      .then(([userRes, pinsRes, boardsRes]) => {
        setProfile(userRes.user);
        setPins(pinsRes.pins);
        setBoards(boardsRes.boards);
        setFollowing(userRes.user.isFollowing || false);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [username]);

  const handleFollow = useCallback(async () => {
    if (!currentUser || !profile) return;

    try {
      if (following) {
        await api.unfollowUser(profile.id);
        setFollowing(false);
        setProfile((prev) =>
          prev ? { ...prev, followerCount: prev.followerCount - 1 } : null,
        );
      } else {
        await api.followUser(profile.id);
        setFollowing(true);
        setProfile((prev) =>
          prev ? { ...prev, followerCount: prev.followerCount + 1 } : null,
        );
      }
    } catch {
      // Revert on error
    }
  }, [currentUser, profile, following]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-pinterest-red rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-2xl font-bold mb-2">User not found</h2>
        <Link to="/" className="text-pinterest-red font-semibold hover:underline mt-4">
          Go home
        </Link>
      </div>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;

  return (
    <div>
      {/* Profile header */}
      <div className="flex flex-col items-center py-8 px-4">
        <UserAvatar
          avatarUrl={profile.avatarUrl}
          username={profile.username}
          displayName={profile.displayName}
          size="xl"
        />

        <h1 className="text-3xl font-bold mt-4">{profile.displayName}</h1>
        <p className="text-text-secondary mt-1">@{profile.username}</p>

        {profile.bio && (
          <p className="text-text-secondary mt-2 text-center max-w-md">{profile.bio}</p>
        )}

        <div className="flex items-center gap-4 mt-3 text-sm">
          <span className="font-bold">{formatNumber(profile.followerCount)} <span className="font-normal text-text-secondary">followers</span></span>
          <span className="font-bold">{formatNumber(profile.followingCount)} <span className="font-normal text-text-secondary">following</span></span>
        </div>

        {/* Follow/Edit button */}
        {currentUser && !isOwnProfile && (
          <button
            onClick={handleFollow}
            className={`mt-4 px-6 py-3 rounded-full font-bold text-sm transition-colors ${
              following
                ? 'bg-black text-white hover:bg-gray-800'
                : 'bg-pinterest-red text-white hover:bg-pinterest-red-hover'
            }`}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex justify-center gap-4 border-b mb-4">
        <button
          onClick={() => setActiveTab('created')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-colors ${
            activeTab === 'created'
              ? 'border-black text-black'
              : 'border-transparent text-text-secondary hover:text-black'
          }`}
        >
          Created
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={`px-4 py-3 font-bold text-sm border-b-2 transition-colors ${
            activeTab === 'saved'
              ? 'border-black text-black'
              : 'border-transparent text-text-secondary hover:text-black'
          }`}
        >
          Saved
        </button>
      </div>

      {/* Content */}
      {activeTab === 'created' ? (
        <MasonryGrid pins={pins} />
      ) : (
        <BoardGrid boards={boards} />
      )}
    </div>
  );
}
