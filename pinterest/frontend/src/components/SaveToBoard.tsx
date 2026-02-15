import { useState, useEffect } from 'react';
import type { Board } from '../types';
import * as api from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface SaveToBoardProps {
  pinId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function SaveToBoard({ pinId, isOpen, onClose, onSaved }: SaveToBoardProps) {
  const { user } = useAuthStore();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  useEffect(() => {
    if (isOpen && user) {
      setLoading(true);
      api
        .getUserBoards(user.username)
        .then(({ boards }) => setBoards(boards))
        .catch(() => setBoards([]))
        .finally(() => setLoading(false));
    }
  }, [isOpen, user]);

  const handleSave = async (boardId: string) => {
    setSaving(true);
    try {
      await api.savePin(pinId, boardId);
      onSaved?.();
      onClose();
    } catch {
      // Handle error silently
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBoard = async () => {
    if (!newBoardName.trim()) return;

    try {
      const { board } = await api.createBoard({ name: newBoardName.trim() });
      setBoards((prev) => [board, ...prev]);
      setNewBoardName('');
      setShowCreate(false);
      // Auto-save to new board
      await handleSave(board.id);
    } catch {
      // Handle error
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-sm mx-4 max-h-[70vh] flex flex-col shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b text-center">
          <h2 className="text-lg font-bold">Save to board</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-pinterest-red rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {boards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => handleSave(board.id)}
                  disabled={saving}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 transition-colors text-left"
                >
                  <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                    {board.coverImageUrl ? (
                      <img src={board.coverImageUrl} alt={board.name} className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{board.name}</p>
                    <p className="text-xs text-text-secondary">{board.pinCount} pins</p>
                  </div>
                </button>
              ))}

              {/* Create new board */}
              {showCreate ? (
                <div className="p-3">
                  <input
                    type="text"
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    placeholder="Board name"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm mb-2"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateBoard()}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCreate(false)}
                      className="btn-secondary text-sm flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateBoard}
                      disabled={!newBoardName.trim()}
                      className="btn-pinterest text-sm flex-1"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="font-semibold text-sm">Create board</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
