import { useState } from 'react';
import { sharesApi } from '../services/api';

interface ShareModalProps {
  videoId: string;
  onClose: () => void;
}

/** Modal for creating and managing share links with password, expiry, and download options. */
export function ShareModal({ videoId, onClose }: ShareModalProps) {
  const [password, setPassword] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      let expiresAt: string | undefined;
      if (expiresIn) {
        const hours = parseInt(expiresIn, 10);
        const date = new Date(Date.now() + hours * 60 * 60 * 1000);
        expiresAt = date.toISOString();
      }

      const { share } = await sharesApi.create(videoId, {
        password: password || undefined,
        expiresAt,
        allowDownload,
      });

      const url = `${window.location.origin}/share/${share.token}`;
      setShareUrl(url);
    } catch {
      // ignore
    }
    setCreating(false);
  };

  const handleCopy = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-loom-text mb-4">Share Video</h2>

        {shareUrl ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-loom-text mb-1">Share Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-loom-border rounded-lg text-sm bg-gray-50"
                />
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover text-sm"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 text-loom-secondary border border-loom-border rounded-lg hover:bg-gray-50"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-loom-text mb-1">Password (optional)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary"
                placeholder="Leave empty for no password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-loom-text mb-1">Expires in</label>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary"
              >
                <option value="">Never</option>
                <option value="1">1 hour</option>
                <option value="24">24 hours</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="rounded border-loom-border text-loom-primary focus:ring-loom-primary"
              />
              <span className="text-sm text-loom-text">Allow download</span>
            </label>

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover font-medium disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Share Link'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-loom-secondary border border-loom-border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
