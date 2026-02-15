import { useState } from 'react';
import { labelApi } from '../services/api';
import { useMailStore } from '../stores/mailStore';

const LABEL_COLORS = [
  '#4285F4',
  '#EA4335',
  '#FBBC04',
  '#34A853',
  '#FF6D01',
  '#46BDC6',
  '#7BAAF7',
  '#F07B72',
  '#FCD04F',
  '#57BB8A',
  '#FF8A65',
  '#4DD0E1',
];

/** Renders the label management UI for creating, editing, and deleting custom labels. */
export function LabelManager() {
  const { labels, fetchLabels } = useMailStore();
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#4285F4');
  const [isCreating, setIsCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const customLabels = labels.filter((l) => !l.isSystem);

  const handleCreate = async () => {
    if (!newLabelName.trim()) return;

    setIsCreating(true);
    try {
      await labelApi.create(newLabelName.trim(), newLabelColor);
      setNewLabelName('');
      setShowForm(false);
      fetchLabels();
    } catch {
      // Handle error
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (labelId: string) => {
    try {
      await labelApi.delete(labelId);
      fetchLabels();
    } catch {
      // Handle error
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gmail-text">Custom Labels</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm text-gmail-blue hover:underline"
        >
          + New label
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <input
            type="text"
            placeholder="Label name"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            className="w-full text-sm border border-gmail-border rounded px-3 py-2 mb-2 outline-none focus:border-gmail-blue"
          />
          <div className="flex flex-wrap gap-1 mb-2">
            {LABEL_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setNewLabelColor(color)}
                className={`w-6 h-6 rounded-full ${
                  newLabelColor === color
                    ? 'ring-2 ring-offset-1 ring-gmail-blue'
                    : ''
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="bg-gmail-blue text-white px-4 py-1.5 rounded text-sm hover:bg-gmail-blue-hover disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-gmail-text-secondary text-sm hover:text-gmail-text px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {customLabels.length === 0 ? (
        <p className="text-sm text-gmail-text-secondary">No custom labels</p>
      ) : (
        <div className="space-y-1">
          {customLabels.map((label) => (
            <div
              key={label.id}
              className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gmail-hover group"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="text-sm text-gmail-text">{label.name}</span>
              </div>
              <button
                onClick={() => handleDelete(label.id)}
                className="text-gmail-text-secondary hover:text-gmail-danger opacity-0 group-hover:opacity-100"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
