import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import SaveToBoard from '../components/SaveToBoard';
import UserAvatar from '../components/UserAvatar';
import { formatNumber, formatRelativeTime } from '../utils/format';
import type { Pin, Comment } from '../types';

export const Route = createFileRoute('/pin/$pinId')({
  component: PinDetailPage,
});

function PinDetailPage() {
  const { pinId } = Route.useParams();
  const { user } = useAuthStore();
  const [pin, setPin] = useState<Pin | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getPin(pinId)
      .then(({ pin }) => {
        setPin(pin);
        setComments(pin.comments || []);
      })
      .catch(() => setPin(null))
      .finally(() => setLoading(false));
  }, [pinId]);

  const handleSave = useCallback(() => {
    if (!user) return;
    setShowSaveModal(true);
  }, [user]);

  const handleComment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!commentText.trim() || !user) return;

      setSubmittingComment(true);
      try {
        const { comment } = await api.createComment(pinId, commentText.trim());
        const enrichedComment: Comment = {
          ...comment,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        };
        setComments((prev) => [enrichedComment, ...prev]);
        setCommentText('');
      } catch {
        // Handle error
      } finally {
        setSubmittingComment(false);
      }
    },
    [pinId, commentText, user],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-pinterest-red rounded-full animate-spin" />
      </div>
    );
  }

  if (!pin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-2xl font-bold mb-2">Pin not found</h2>
        <Link to="/" className="text-pinterest-red font-semibold hover:underline mt-4">
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-modal overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Image */}
          <div
            className="md:w-1/2 flex-shrink-0"
            style={{ backgroundColor: pin.dominantColor || '#e8e8e8' }}
          >
            <img
              src={pin.imageUrl}
              alt={pin.title || 'Pin'}
              className="w-full h-auto"
            />
          </div>

          {/* Details */}
          <div className="md:w-1/2 p-6 flex flex-col">
            {/* Actions */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {pin.linkUrl && (
                  <a
                    href={pin.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-text-secondary hover:underline flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {new URL(pin.linkUrl).hostname}
                  </a>
                )}
              </div>
              {user && (
                <button onClick={handleSave} className="save-btn">
                  {pin.isSaved ? 'Saved' : 'Save'}
                </button>
              )}
            </div>

            {/* Title */}
            {pin.title && <h1 className="text-2xl font-bold mb-2">{pin.title}</h1>}

            {/* Description */}
            {pin.description && (
              <p className="text-text-secondary mb-4">{pin.description}</p>
            )}

            {/* Author */}
            <Link
              to="/profile/$username"
              params={{ username: pin.username }}
              className="flex items-center gap-3 mb-4 hover:bg-gray-50 rounded-xl p-2 -mx-2"
            >
              <UserAvatar
                avatarUrl={pin.avatarUrl}
                username={pin.username}
                displayName={pin.displayName}
                size="lg"
              />
              <div>
                <p className="font-bold">{pin.displayName}</p>
                <p className="text-text-secondary text-sm">
                  {formatNumber(pin.saveCount)} saves
                </p>
              </div>
            </Link>

            {/* Comments section */}
            <div className="flex-1 overflow-y-auto border-t pt-4">
              <h3 className="font-bold mb-3">
                {pin.commentCount} {pin.commentCount === 1 ? 'Comment' : 'Comments'}
              </h3>

              <div className="space-y-4 mb-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <UserAvatar
                      avatarUrl={comment.avatarUrl}
                      username={comment.username}
                      displayName={comment.displayName}
                      size="sm"
                    />
                    <div>
                      <p className="text-sm">
                        <Link
                          to="/profile/$username"
                          params={{ username: comment.username }}
                          className="font-bold hover:underline"
                        >
                          {comment.displayName}
                        </Link>{' '}
                        {comment.content}
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        {formatRelativeTime(comment.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add comment */}
              {user && (
                <form onSubmit={handleComment} className="flex items-center gap-2 border-t pt-4">
                  <UserAvatar
                    avatarUrl={user.avatarUrl}
                    username={user.username}
                    displayName={user.displayName}
                    size="sm"
                  />
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment"
                    className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm outline-none focus:border-gray-400"
                  />
                  <button
                    type="submit"
                    disabled={!commentText.trim() || submittingComment}
                    className="text-pinterest-red font-bold text-sm disabled:opacity-50"
                  >
                    Post
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save to board modal */}
      <SaveToBoard
        pinId={pinId}
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSaved={() => setPin((prev) => prev ? { ...prev, isSaved: true } : null)}
      />
    </div>
  );
}
