import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useVideoStore } from '../stores/videoStore';
import { RecordingInterface } from '../components/RecordingInterface';
import { RecordingPreview } from '../components/RecordingPreview';
import { UploadProgress } from '../components/UploadProgress';

function RecordPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const recordedBlob = useVideoStore((s) => s.recordedBlob);
  const setRecordedBlob = useVideoStore((s) => s.setRecordedBlob);
  const uploading = useVideoStore((s) => s.uploading);
  const uploadProgress = useVideoStore((s) => s.uploadProgress);
  const createAndUpload = useVideoStore((s) => s.createAndUpload);
  const error = useVideoStore((s) => s.error);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const durationRef = useRef(0);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Cleanup blob on unmount
    return () => {
      setRecordedBlob(null);
    };
  }, [setRecordedBlob]);

  const handleRecordingComplete = (blob: Blob, duration: number) => {
    setRecordedBlob(blob);
    durationRef.current = duration;
    setTitle(`Recording ${new Date().toLocaleDateString()}`);
  };

  const handleUpload = async () => {
    if (!recordedBlob || !title.trim()) return;
    try {
      const video = await createAndUpload(title.trim(), recordedBlob, durationRef.current, description.trim() || undefined);
      setRecordedBlob(null);
      navigate({ to: '/videos/$videoId', params: { videoId: video.id } });
    } catch {
      // error is set in store
    }
  };

  const handleDiscard = () => {
    setRecordedBlob(null);
    setTitle('');
    setDescription('');
  };

  if (loading || !user) return null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-loom-text mb-6">Record Video</h1>

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      {uploading ? (
        <UploadProgress progress={uploadProgress} />
      ) : recordedBlob ? (
        <div className="space-y-6">
          <RecordingPreview blob={recordedBlob} />

          <div className="bg-white rounded-lg border border-loom-border p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-loom-text mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary"
                  placeholder="Give your video a title"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-loom-text mb-1">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary resize-none"
                  rows={3}
                  placeholder="Add a description..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleUpload}
                  disabled={!title.trim()}
                  className="px-6 py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Upload Video
                </button>
                <button
                  onClick={handleDiscard}
                  className="px-6 py-2 text-loom-secondary border border-loom-border rounded-lg hover:bg-gray-50"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <RecordingInterface onRecordingComplete={handleRecordingComplete} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/record')({
  component: RecordPage,
});
