import { useState } from 'react';
import { tweetsApi } from '../services/api';
import { useTimelineStore } from '../stores/timelineStore';
import { useAuthStore } from '../stores/authStore';

interface ComposeTweetProps {
  replyTo?: string;
  onSuccess?: () => void;
  placeholder?: string;
}

export function ComposeTweet({ replyTo, onSuccess, placeholder = "What's happening?" }: ComposeTweetProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { addTweet } = useTimelineStore();

  const maxLength = 280;
  const remaining = maxLength - content.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim() || content.length > maxLength) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { tweet } = await tweetsApi.create(content.trim(), { replyTo });
      addTweet(tweet);
      setContent('');
      onSuccess?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="p-4 border-b border-twitter-border bg-white">
        <p className="text-twitter-gray text-center text-[15px]">
          <a href="/login" className="text-twitter-blue hover:underline">Log in</a> to tweet
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-twitter-border bg-white">
      <div className="flex gap-3">
        <div className="w-12 h-12 rounded-full bg-twitter-blue flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          {user.displayName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            className="w-full resize-none border-0 focus:ring-0 text-xl placeholder-twitter-gray outline-none min-h-[52px] text-twitter-dark bg-transparent"
            rows={2}
          />

          {error && (
            <p className="text-twitter-like text-[13px] mb-2">{error}</p>
          )}

          <div className="flex items-center justify-between border-t border-twitter-border pt-3 mt-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="p-2 rounded-full hover:bg-twitter-blue/10 text-twitter-blue transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                type="button"
                className="p-2 rounded-full hover:bg-twitter-blue/10 text-twitter-blue transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-4">
              {content.length > 0 && (
                <div className={`text-[13px] font-medium ${remaining < 0 ? 'text-twitter-like' : remaining < 20 ? 'text-yellow-500' : 'text-twitter-gray'}`}>
                  {remaining}
                </div>
              )}

              <button
                type="submit"
                disabled={!content.trim() || content.length > maxLength || isSubmitting}
                className="px-4 py-1.5 bg-twitter-blue text-white rounded-full font-bold text-[15px] hover:bg-twitter-blueHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Posting...' : replyTo ? 'Reply' : 'Tweet'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
