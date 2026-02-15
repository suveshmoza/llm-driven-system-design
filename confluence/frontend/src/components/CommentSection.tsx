import { useState, useEffect } from 'react';
import * as api from '../services/api';
import type { Comment } from '../types';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/format';

interface CommentSectionProps {
  pageId: string;
}

/** Renders threaded comments with reply, resolve, and delete capabilities. */
export default function CommentSection({ pageId }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    setLoading(true);
    api.getComments(pageId).then(({ comments: c }) => {
      setComments(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pageId]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      const { comment } = await api.addComment(pageId, newComment);
      setComments([...comments, { ...comment, replies: [] }]);
      setNewComment('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add comment');
    }
  };

  const handleReply = async (parentId: string) => {
    if (!replyContent.trim()) return;

    try {
      const { comment } = await api.addComment(pageId, replyContent, parentId);
      setComments(comments.map(c =>
        c.id === parentId
          ? { ...c, replies: [...(c.replies || []), comment] }
          : c
      ));
      setReplyingTo(null);
      setReplyContent('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reply');
    }
  };

  const handleResolve = async (commentId: string) => {
    try {
      const { comment } = await api.resolveComment(commentId);
      setComments(comments.map(c =>
        c.id === commentId ? { ...c, is_resolved: comment.is_resolved } : c
      ));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resolve comment');
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      await api.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete comment');
    }
  };

  if (loading) {
    return <div className="text-confluence-text-subtle text-sm">Loading comments...</div>;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-confluence-text mb-4">
        Comments ({comments.length})
      </h3>

      {/* Comment list */}
      <div className="space-y-4 mb-6">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className={`p-4 rounded-lg border ${
              comment.is_resolved
                ? 'bg-green-50 border-green-200'
                : 'bg-white border-confluence-border'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-confluence-primary rounded-full flex items-center justify-center">
                <span className="text-white text-xs">
                  {(comment.display_name || comment.username).charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-medium text-confluence-text">
                {comment.display_name || comment.username}
              </span>
              <span className="text-xs text-confluence-text-muted">
                {formatDate(comment.created_at)}
              </span>
              {comment.is_resolved && (
                <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                  Resolved
                </span>
              )}
            </div>

            <p className="text-sm text-confluence-text mb-2">{comment.content}</p>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {user && (
                <>
                  <button
                    onClick={() => {
                      setReplyingTo(replyingTo === comment.id ? null : comment.id);
                      setReplyContent('');
                    }}
                    className="text-xs text-confluence-primary hover:underline"
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => handleResolve(comment.id)}
                    className="text-xs text-confluence-text-subtle hover:text-confluence-primary"
                  >
                    {comment.is_resolved ? 'Unresolve' : 'Resolve'}
                  </button>
                  {comment.user_id === user.id && (
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="text-xs text-confluence-danger hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Reply form */}
            {replyingTo === comment.id && (
              <div className="mt-3 ml-6">
                <textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="Write a reply..."
                  className="w-full px-3 py-2 text-sm border border-confluence-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-confluence-primary"
                  rows={2}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleReply(comment.id)}
                    className="px-3 py-1 text-xs bg-confluence-primary text-white rounded hover:bg-confluence-hover"
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => setReplyingTo(null)}
                    className="px-3 py-1 text-xs text-confluence-text-subtle border border-confluence-border rounded hover:bg-confluence-sidebar"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="ml-6 mt-3 space-y-3 border-l-2 border-confluence-border pl-4">
                {comment.replies.map((reply) => (
                  <div key={reply.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 bg-confluence-text-muted rounded-full flex items-center justify-center">
                        <span className="text-white text-[10px]">
                          {(reply.display_name || reply.username).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-confluence-text">
                        {reply.display_name || reply.username}
                      </span>
                      <span className="text-xs text-confluence-text-muted">
                        {formatDate(reply.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-confluence-text">{reply.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New comment form */}
      {user ? (
        <form onSubmit={handleAddComment} className="flex gap-3">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment..."
            className="flex-1 px-3 py-2 text-sm border border-confluence-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-confluence-primary"
            rows={2}
          />
          <button
            type="submit"
            disabled={!newComment.trim()}
            className="self-end px-4 py-2 text-sm bg-confluence-primary text-white rounded hover:bg-confluence-hover disabled:opacity-50 transition-colors"
          >
            Comment
          </button>
        </form>
      ) : (
        <p className="text-sm text-confluence-text-subtle">
          Log in to add comments.
        </p>
      )}
    </div>
  );
}
