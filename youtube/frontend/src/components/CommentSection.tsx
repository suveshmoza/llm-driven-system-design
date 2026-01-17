import { useState, useEffect } from 'react';
import { Comment } from '../types';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { timeAgo, getAvatarUrl } from '../utils/format';

/**
 * Props for the CommentSection component.
 */
interface CommentSectionProps {
  /** ID of the video to display comments for */
  videoId: string;
  /** Total number of comments for display */
  commentCount: number;
}

/**
 * Video comment section component.
 * Displays comments for a video with support for adding new comments,
 * replying to existing comments, and liking comments. Requires
 * authentication for interactive features.
 *
 * @param props.videoId - The video ID to fetch comments for
 * @param props.commentCount - Displayed count in the section header
 */
export default function CommentSection({ videoId, commentCount }: CommentSectionProps) {
  const { user } = useAuthStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [videoId]);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const response = await api.get<{ comments: Comment[] }>(`/videos/${videoId}/comments`);
      setComments(response.comments);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    setIsSubmitting(true);
    try {
      const response = await api.post<Comment>(`/videos/${videoId}/comments`, {
        text: newComment.trim(),
      });
      setComments([response, ...comments]);
      setNewComment('');
      setIsFocused(false);
    } catch (error) {
      console.error('Failed to submit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string) => {
    if (!replyText.trim() || !user) return;

    setIsSubmitting(true);
    try {
      const response = await api.post<Comment>(`/videos/${videoId}/comments`, {
        text: replyText.trim(),
        parentId,
      });

      // Add reply to the comment
      setComments(comments.map(c => {
        if (c.id === parentId) {
          return { ...c, replyCount: (c.replyCount || 0) + 1 };
        }
        return c;
      }));

      setReplyingTo(null);
      setReplyText('');
    } catch (error) {
      console.error('Failed to submit reply:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!user) return;

    try {
      await api.post(`/videos/${videoId}/comments/${commentId}/like`);
      // Update local state optimistically
      setComments(comments.map(c => {
        if (c.id === commentId) {
          return { ...c, likeCount: c.likeCount + 1 };
        }
        return c;
      }));
    } catch (error) {
      console.error('Failed to like comment:', error);
    }
  };

  return (
    <div className="mt-6">
      {/* Header with comment count and sort */}
      <div className="flex items-center gap-6 mb-6">
        <h3 className="text-xl font-medium">{commentCount.toLocaleString()} Comments</h3>
        <button className="flex items-center gap-2 text-sm font-medium hover:bg-yt-dark-hover px-3 py-2 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 6H3V5h18v1zm-6 5H3v1h12v-1zm-6 6H3v1h6v-1z"/>
          </svg>
          Sort by
        </button>
      </div>

      {/* Add comment form */}
      {user ? (
        <form onSubmit={handleSubmitComment} className="flex gap-4 mb-8">
          <img
            src={getAvatarUrl(null, user.username)}
            alt={user.username}
            className="w-10 h-10 rounded-full flex-shrink-0"
          />
          <div className="flex-1">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onFocus={() => setIsFocused(true)}
              placeholder="Add a comment..."
              className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none pb-2 text-sm placeholder-yt-text-secondary-dark"
            />
            {(isFocused || newComment) && (
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setNewComment('');
                    setIsFocused(false);
                  }}
                  className="px-4 py-2 text-sm font-medium hover:bg-yt-dark-hover rounded-full transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newComment.trim() || isSubmitting}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    newComment.trim()
                      ? 'bg-yt-blue-light text-black hover:bg-blue-400'
                      : 'bg-yt-dark-hover text-yt-text-secondary-dark cursor-not-allowed'
                  }`}
                >
                  Comment
                </button>
              </div>
            )}
          </div>
        </form>
      ) : (
        <p className="text-yt-text-secondary-dark mb-8 text-sm">Sign in to comment</p>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-yt-text-secondary-dark">
          <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          <span>Loading comments...</span>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-yt-text-secondary-dark">No comments yet. Be the first to comment!</p>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-4">
              <img
                src={getAvatarUrl(comment.user.avatarUrl, comment.user.username)}
                alt={comment.user.username}
                className="w-10 h-10 rounded-full flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-[13px]">@{comment.user.username}</span>
                  <span className="text-xs text-yt-text-secondary-dark">{timeAgo(comment.createdAt)}</span>
                  {comment.isEdited && <span className="text-xs text-yt-text-secondary-dark">(edited)</span>}
                </div>
                <p className="text-sm leading-5 mb-2 whitespace-pre-wrap">{comment.text}</p>

                {/* Comment actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleLikeComment(comment.id)}
                    className="p-2 -ml-2 rounded-full hover:bg-yt-dark-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1l5.5 0c1.5-.02 2.87-1.1 3.27-2.55l1.38-5.03c.43-1.56-.58-3.19-2.18-3.7zM5 13v6H4v-6h1zm4 6V12l5.76-6.43c.18-.2.43-.31.69-.31.4 0 .74.28.86.66L14.6 10.4l-1.69 5.5h6.09c.78.25 1.11 1.14.73 1.84l-1.38 5.03c-.18.65-.76 1.11-1.44 1.12L9 24V19z"/>
                    </svg>
                  </button>
                  {comment.likeCount > 0 && (
                    <span className="text-xs text-yt-text-secondary-dark">{comment.likeCount}</span>
                  )}
                  <button className="p-2 rounded-full hover:bg-yt-dark-hover transition-colors">
                    <svg className="w-4 h-4 rotate-180" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1l5.5 0c1.5-.02 2.87-1.1 3.27-2.55l1.38-5.03c.43-1.56-.58-3.19-2.18-3.7zM5 13v6H4v-6h1zm4 6V12l5.76-6.43c.18-.2.43-.31.69-.31.4 0 .74.28.86.66L14.6 10.4l-1.69 5.5h6.09c.78.25 1.11 1.14.73 1.84l-1.38 5.03c-.18.65-.76 1.11-1.44 1.12L9 24V19z"/>
                    </svg>
                  </button>
                  {user && (
                    <button
                      onClick={() => setReplyingTo(comment.id)}
                      className="text-xs font-medium ml-2 px-3 py-2 hover:bg-yt-dark-hover rounded-full transition-colors"
                    >
                      Reply
                    </button>
                  )}
                </div>

                {/* Show replies count */}
                {comment.replyCount && comment.replyCount > 0 && (
                  <button className="flex items-center gap-2 text-yt-blue-light text-sm font-medium mt-2 px-3 py-2 -ml-3 rounded-full hover:bg-yt-blue-light/10 transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
                  </button>
                )}

                {/* Reply form */}
                {replyingTo === comment.id && (
                  <div className="flex gap-3 mt-3">
                    <img
                      src={getAvatarUrl(null, user!.username)}
                      alt={user!.username}
                      className="w-6 h-6 rounded-full flex-shrink-0"
                    />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Add a reply..."
                        className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none pb-1 text-sm placeholder-yt-text-secondary-dark"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyText('');
                          }}
                          className="px-3 py-1.5 text-sm font-medium hover:bg-yt-dark-hover rounded-full transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSubmitReply(comment.id)}
                          disabled={!replyText.trim() || isSubmitting}
                          className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                            replyText.trim()
                              ? 'bg-yt-blue-light text-black hover:bg-blue-400'
                              : 'bg-yt-dark-hover text-yt-text-secondary-dark cursor-not-allowed'
                          }`}
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
