import { useState } from 'react';
import { channelApi } from '../services/api';
import { useChatStore } from '../stores/chatStore';

interface CreateChannelModalProps {
  teamId: string;
  onClose: () => void;
}

/** Modal form for creating a new channel within a team. */
export function CreateChannelModal({ teamId, onClose }: CreateChannelModalProps) {
  const { loadChannels } = useChatStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError('');

    try {
      await channelApi.create(teamId, name.trim(), description.trim() || undefined, isPrivate);
      await loadChannels(teamId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-teams-surface rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-bold text-teams-text mb-4">Create Channel</h2>

        {error && (
          <div className="bg-red-50 text-teams-danger rounded-md p-3 mb-4 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-teams-text mb-1">
              Channel Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-teams-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teams-primary text-sm"
              placeholder="e.g., project-updates"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-teams-text mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-teams-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teams-primary text-sm"
              placeholder="What is this channel about?"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="private"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-teams-border"
            />
            <label htmlFor="private" className="text-sm text-teams-text">
              Make this channel private
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-teams-text hover:bg-teams-bg rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-2 text-sm bg-teams-primary text-white rounded-md hover:bg-teams-hover disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
