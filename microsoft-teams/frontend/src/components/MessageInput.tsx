import { useState, useRef } from 'react';
import { fileApi } from '../services/api';

interface MessageInputProps {
  onSend: (content: string) => void;
  channelId: string;
  placeholder?: string;
}

/** Message composition input with file attachment button and enter-to-send. */
export function MessageInput({ onSend, channelId, placeholder }: MessageInputProps) {
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSend(content.trim());
    setContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await fileApi.upload(channelId, file);
      onSend(`[File: ${file.name}]`);
    } catch (err) {
      console.error('Failed to upload file:', err);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="px-4 pb-4">
      <form
        onSubmit={handleSubmit}
        className="bg-teams-surface border border-teams-border rounded-lg flex items-end"
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-3 text-teams-secondary hover:text-teams-text transition-colors"
          title="Attach file"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Type a message...'}
          rows={1}
          className="flex-1 py-3 px-1 resize-none bg-transparent text-sm text-teams-text placeholder-teams-secondary focus:outline-none max-h-32"
          style={{ minHeight: '44px' }}
        />

        <button
          type="submit"
          disabled={!content.trim()}
          className="p-3 text-teams-primary hover:text-teams-hover disabled:text-teams-border transition-colors"
          title="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
        />
      </form>
    </div>
  );
}
