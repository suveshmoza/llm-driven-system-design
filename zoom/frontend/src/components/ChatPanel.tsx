import { useState, useRef, useEffect } from 'react';
import { useMeetingStore } from '../stores/meetingStore';
import { useAuthStore } from '../stores/authStore';
import { wsClient } from '../services/websocket';
import { formatTime } from '../utils/format';

/** Renders the in-meeting chat panel with message history and send input. */
export function ChatPanel() {
  const { chatMessages, participants } = useMeetingStore();
  const { user } = useAuthStore();
  const [message, setMessage] = useState('');
  const [recipientId, setRecipientId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    wsClient.sendChatMessage(message.trim(), recipientId || undefined);
    setMessage('');
  };

  const otherParticipants = participants.filter((p) => p.userId !== user?.id);

  return (
    <div className="w-72 bg-zoom-surface border-l border-zoom-card flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zoom-card">
        <h2 className="text-sm font-semibold text-zoom-text">Chat</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {chatMessages.map((msg) => {
          const isMe = msg.senderId === user?.id;
          const isDM = !!msg.recipientId;

          return (
            <div key={msg.id} className={`${isMe ? 'text-right' : ''}`}>
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className={`text-xs font-medium ${isMe ? 'text-zoom-primary ml-auto' : 'text-zoom-primary'}`}>
                  {isMe ? 'You' : msg.senderName}
                </span>
                {isDM && (
                  <span className="text-[10px] text-orange-400 italic">
                    (DM)
                  </span>
                )}
                <span className="text-[10px] text-zoom-secondary">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              <div
                className={`inline-block rounded-lg px-3 py-1.5 text-sm max-w-[90%] text-left ${
                  isMe
                    ? 'bg-zoom-primary text-white'
                    : 'bg-zoom-card text-zoom-text'
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Send message */}
      <div className="border-t border-zoom-card p-3">
        <div className="mb-2">
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="w-full bg-zoom-card border border-zoom-card rounded px-2 py-1 text-xs text-zoom-secondary focus:outline-none focus:border-zoom-primary"
          >
            <option value="">Everyone</option>
            {otherParticipants.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName} (DM)
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-zoom-card border border-zoom-card rounded-lg px-3 py-2 text-sm text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary"
          />
          <button
            type="submit"
            disabled={!message.trim()}
            className="bg-zoom-primary hover:bg-zoom-hover disabled:opacity-50 text-white px-3 py-2 rounded-lg transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
