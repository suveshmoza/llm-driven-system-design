import { useRef, useEffect } from 'react';

interface RecordingPreviewProps {
  blob: Blob;
}

/** Renders a playback preview of the recorded video blob before upload. */
export function RecordingPreview({ blob }: RecordingPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      const url = URL.createObjectURL(blob);
      videoRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [blob]);

  const fileSizeMB = (blob.size / (1024 * 1024)).toFixed(1);

  return (
    <div className="space-y-3">
      <div className="aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          controls
          className="w-full h-full"
        />
      </div>
      <div className="text-sm text-loom-secondary text-center">
        File size: {fileSizeMB} MB
      </div>
    </div>
  );
}
