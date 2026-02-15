import { useState } from 'react';
import { messageApi } from '../services/api';
import { useMailStore } from '../stores/mailStore';
import { ContactAutocomplete } from './ContactAutocomplete';

interface ComposeModalProps {
  onClose: () => void;
}

/** Renders a compose email modal with To/CC/BCC fields, subject, body, and send action. */
export function ComposeModal({ onClose }: ComposeModalProps) {
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const { fetchThreads, fetchUnreadCounts } = useMailStore();

  const handleSend = async () => {
    if (to.length === 0) {
      setError('At least one recipient is required');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }
    if (!bodyText.trim()) {
      setError('Message body is required');
      return;
    }

    setIsSending(true);
    setError('');

    try {
      await messageApi.send({
        to,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject,
        bodyText,
      });

      fetchThreads();
      fetchUnreadCounts();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-0 right-20 w-72 bg-white shadow-lg rounded-t-lg border border-gmail-border z-50">
        <div
          className="flex items-center justify-between px-4 py-2 bg-gmail-text rounded-t-lg cursor-pointer"
          onClick={() => setIsMinimized(false)}
        >
          <span className="text-white text-sm font-medium">
            {subject || 'New Message'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(false);
              }}
              className="text-gray-300 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="currentColor" d="M7 14l5-5 5 5z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-gray-300 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 right-20 w-[560px] bg-white shadow-2xl rounded-t-lg border border-gmail-border z-50 flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gmail-text rounded-t-lg flex-shrink-0">
        <span className="text-white text-sm font-medium">New Message</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="text-gray-300 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </button>
          <button onClick={onClose} className="text-gray-300 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-4 py-2 bg-red-50 text-gmail-danger text-sm">
            {error}
          </div>
        )}

        {/* To */}
        <div className="flex items-start border-b border-gmail-border px-4 py-1">
          <span className="text-sm text-gmail-text-secondary mr-2 mt-1.5">
            To
          </span>
          <div className="flex-1">
            <ContactAutocomplete
              selected={to}
              onChange={setTo}
              placeholder=""
            />
          </div>
          <div className="flex items-center gap-1 mt-1.5 ml-2">
            {!showCc && (
              <button
                onClick={() => setShowCc(true)}
                className="text-xs text-gmail-text-secondary hover:text-gmail-text"
              >
                Cc
              </button>
            )}
            {!showBcc && (
              <button
                onClick={() => setShowBcc(true)}
                className="text-xs text-gmail-text-secondary hover:text-gmail-text"
              >
                Bcc
              </button>
            )}
          </div>
        </div>

        {/* CC */}
        {showCc && (
          <div className="flex items-start border-b border-gmail-border px-4 py-1">
            <span className="text-sm text-gmail-text-secondary mr-2 mt-1.5">
              Cc
            </span>
            <div className="flex-1">
              <ContactAutocomplete
                selected={cc}
                onChange={setCc}
                placeholder=""
              />
            </div>
          </div>
        )}

        {/* BCC */}
        {showBcc && (
          <div className="flex items-start border-b border-gmail-border px-4 py-1">
            <span className="text-sm text-gmail-text-secondary mr-2 mt-1.5">
              Bcc
            </span>
            <div className="flex-1">
              <ContactAutocomplete
                selected={bcc}
                onChange={setBcc}
                placeholder=""
              />
            </div>
          </div>
        )}

        {/* Subject */}
        <div className="border-b border-gmail-border px-4">
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full py-2 text-sm text-gmail-text placeholder-gmail-text-secondary outline-none"
          />
        </div>

        {/* Body */}
        <div className="px-4 py-2">
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Compose email"
            className="w-full min-h-[200px] text-sm text-gmail-text outline-none resize-y"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gmail-border flex-shrink-0">
        <button
          onClick={handleSend}
          disabled={isSending}
          className="bg-gmail-blue text-white px-6 py-2 rounded-full text-sm hover:bg-gmail-blue-hover disabled:opacity-50"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>

        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-gmail-hover"
          title="Discard"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#5F6368"
              d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
