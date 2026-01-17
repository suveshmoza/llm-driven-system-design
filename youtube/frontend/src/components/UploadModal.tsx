import { useState, useRef } from 'react';
import { useUploadStore } from '../stores/uploadStore';
import { useNavigate } from '@tanstack/react-router';
import { formatFileSize } from '../utils/format';

/**
 * Props for the UploadModal component.
 */
interface UploadModalProps {
  /** Callback to close the modal */
  onClose: () => void;
}

/**
 * Video upload modal component.
 * Guides users through a multi-step upload process: file selection,
 * metadata entry (title, description, categories, tags), upload
 * progress display, and completion confirmation. Supports drag-and-drop
 * file selection and navigates to the video page on success.
 *
 * @param props.onClose - Called when modal should be dismissed
 */
export default function UploadModal({ onClose }: UploadModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentUpload, isUploading, error, startUpload, cancelUpload, clearUpload } = useUploadStore();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState('');
  const [tags, setTags] = useState('');
  const [step, setStep] = useState<'select' | 'details' | 'uploading' | 'complete'>('select');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      if (!validTypes.includes(file.type)) {
        alert('Please select a valid video file (MP4, WebM, MOV, AVI)');
        return;
      }

      setSelectedFile(file);
      setTitle(file.name.replace(/\.[^/.]+$/, '')); // Remove extension
      setStep('details');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !title.trim()) return;

    try {
      setStep('uploading');

      const categoriesArray = categories.split(',').map(c => c.trim()).filter(c => c);
      const tagsArray = tags.split(',').map(t => t.trim()).filter(t => t);

      const videoId = await startUpload(
        selectedFile,
        title.trim(),
        description.trim(),
        categoriesArray,
        tagsArray
      );

      setStep('complete');

      // Redirect to video page after a short delay
      setTimeout(() => {
        clearUpload();
        onClose();
        navigate({ to: '/watch/$videoId', params: { videoId } });
      }, 2000);
    } catch {
      setStep('details');
    }
  };

  const handleCancel = async () => {
    if (isUploading) {
      await cancelUpload();
    }
    clearUpload();
    onClose();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setSelectedFile(file);
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
      setStep('details');
    }
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div
        className="bg-yt-dark-secondary rounded-xl max-w-2xl w-full mx-4 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-medium">Upload videos</h2>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-yt-dark-hover rounded-full transition-colors"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step: Select file */}
          {step === 'select' && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-yt-blue-light bg-yt-blue-light/5'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="w-24 h-24 bg-yt-dark-hover rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-yt-text-secondary-dark" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
                </svg>
              </div>
              <p className="text-base mb-2">Drag and drop video files to upload</p>
              <p className="text-sm text-yt-text-secondary-dark mb-6">Your videos will be private until you publish them.</p>
              <button
                type="button"
                className="bg-yt-blue-light text-black font-medium px-4 py-2.5 rounded-full hover:bg-blue-400 transition-colors"
              >
                SELECT FILES
              </button>
            </div>
          )}

          {/* Step: Enter details */}
          {step === 'details' && selectedFile && (
            <div className="space-y-5">
              {/* File preview */}
              <div className="bg-yt-dark-hover rounded-xl p-4 flex items-center gap-4">
                <div className="w-32 h-20 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-8 h-8 text-yt-text-secondary-dark" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{selectedFile.name}</p>
                  <p className="text-sm text-yt-text-secondary-dark">{formatFileSize(selectedFile.size)}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setStep('select');
                  }}
                  className="p-2 hover:bg-yt-dark-elevated rounded-full transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm text-yt-text-secondary-dark mb-2">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent border border-gray-600 text-white px-4 py-3 rounded-lg focus:border-yt-blue-light focus:outline-none focus:ring-1 focus:ring-yt-blue-light transition-colors"
                  placeholder="Add a title that describes your video"
                  maxLength={100}
                  required
                />
                <p className="text-xs text-yt-text-secondary-dark mt-1 text-right">{title.length}/100</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-yt-text-secondary-dark mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-transparent border border-gray-600 text-white px-4 py-3 rounded-lg focus:border-yt-blue-light focus:outline-none focus:ring-1 focus:ring-yt-blue-light transition-colors h-28 resize-none"
                  placeholder="Tell viewers about your video"
                />
              </div>

              {/* Categories */}
              <div>
                <label className="block text-sm text-yt-text-secondary-dark mb-2">Categories</label>
                <input
                  type="text"
                  value={categories}
                  onChange={(e) => setCategories(e.target.value)}
                  className="w-full bg-transparent border border-gray-600 text-white px-4 py-3 rounded-lg focus:border-yt-blue-light focus:outline-none focus:ring-1 focus:ring-yt-blue-light transition-colors"
                  placeholder="e.g., Gaming, Music, Education (comma-separated)"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm text-yt-text-secondary-dark mb-2">Tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-transparent border border-gray-600 text-white px-4 py-3 rounded-lg focus:border-yt-blue-light focus:outline-none focus:ring-1 focus:ring-yt-blue-light transition-colors"
                  placeholder="e.g., tutorial, review, vlog (comma-separated)"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {/* Step: Uploading */}
          {step === 'uploading' && currentUpload && (
            <div className="text-center py-12">
              <div className="w-20 h-20 mx-auto mb-6 relative">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#3f3f3f"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#3EA6FF"
                    strokeWidth="3"
                    strokeDasharray={`${currentUpload.progress}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-lg font-medium">
                  {currentUpload.progress}%
                </span>
              </div>
              <p className="text-lg font-medium mb-2">Uploading...</p>
              <p className="text-yt-text-secondary-dark mb-6">
                {currentUpload.phase === 'uploading' ? 'Uploading video file...' : 'Processing video...'}
              </p>
              <button
                onClick={handleCancel}
                className="text-yt-blue-light hover:underline font-medium"
              >
                Cancel upload
              </button>
            </div>
          )}

          {/* Step: Complete */}
          {step === 'complete' && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
              <p className="text-xl font-medium mb-2">Upload complete!</p>
              <p className="text-yt-text-secondary-dark">Your video is being processed and will be ready soon.</p>
            </div>
          )}
        </div>

        {/* Footer - only show for details step */}
        {step === 'details' && (
          <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
            <button
              onClick={() => {
                setSelectedFile(null);
                setStep('select');
              }}
              className="px-4 py-2 text-sm font-medium hover:bg-yt-dark-hover rounded-full transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleUpload}
              disabled={!title.trim()}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                title.trim()
                  ? 'bg-yt-blue-light text-black hover:bg-blue-400'
                  : 'bg-yt-dark-hover text-yt-text-secondary-dark cursor-not-allowed'
              }`}
            >
              Upload
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
