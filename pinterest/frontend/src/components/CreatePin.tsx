import { useState, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';
import * as api from '../services/api';
import type { Board } from '../types';

export default function CreatePin() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load boards on first interaction
  const loadBoards = useCallback(async () => {
    if (boardsLoaded || !user) return;
    try {
      const { boards } = await api.getUserBoards(user.username);
      setBoards(boards);
      if (boards.length > 0) setSelectedBoard(boards[0].id);
    } catch {
      // Ignore
    }
    setBoardsLoaded(true);
  }, [boardsLoaded, user]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (!selectedFile) return;

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(selectedFile.type)) {
        setError('Please upload a JPEG, PNG, WebP, or GIF image');
        return;
      }

      // Validate file size (20MB max)
      if (selectedFile.size > 20 * 1024 * 1024) {
        setError('Image must be smaller than 20MB');
        return;
      }

      setFile(selectedFile);
      setError(null);

      // Create preview
      const reader = new FileReader();
      reader.onload = (event) => {
        setPreview(event.target?.result as string);
      };
      reader.readAsDataURL(selectedFile);

      loadBoards();
    },
    [loadBoards],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!file) {
        setError('Please select an image');
        return;
      }

      setUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('image', file);
        if (title.trim()) formData.append('title', title.trim());
        if (description.trim()) formData.append('description', description.trim());
        if (linkUrl.trim()) formData.append('linkUrl', linkUrl.trim());
        if (selectedBoard) formData.append('boardId', selectedBoard);

        const { pin } = await api.createPin(formData);
        navigate({ to: '/pin/$pinId', params: { pinId: pin.id } });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [file, title, description, linkUrl, selectedBoard, navigate],
  );

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-pin p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Create Pin</h1>
          <button
            onClick={handleSubmit}
            disabled={!file || uploading}
            className="btn-pinterest"
          >
            {uploading ? 'Publishing...' : 'Publish'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col md:flex-row gap-8">
            {/* Image upload area */}
            <div className="md:w-1/2">
              {preview ? (
                <div className="relative rounded-2xl overflow-hidden">
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-full rounded-2xl"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="absolute top-3 right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-pin hover:shadow-pin-hover transition-shadow"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors min-h-[400px]"
                >
                  <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-text-secondary text-sm mb-1">Click to upload</p>
                  <p className="text-text-gray text-xs">JPEG, PNG, WebP, GIF (max 20MB)</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Pin details */}
            <div className="md:w-1/2 space-y-4">
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Add a title"
                  maxLength={255}
                  className="w-full text-3xl font-bold border-b-2 border-gray-200 pb-2 outline-none focus:border-blue-500 placeholder-gray-300"
                />
              </div>

              <div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell everyone what your Pin is about"
                  rows={4}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="Add a destination link"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              {boards.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold mb-1">Board</label>
                  <select
                    value={selectedBoard}
                    onChange={(e) => setSelectedBoard(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="">No board</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
