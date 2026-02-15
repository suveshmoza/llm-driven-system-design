interface UploadProgressProps {
  progress: number;
}

/** Displays a 5-stage upload progress indicator with percentage bar. */
export function UploadProgress({ progress }: UploadProgressProps) {
  const getLabel = () => {
    if (progress < 15) return 'Creating video...';
    if (progress < 25) return 'Preparing upload...';
    if (progress < 85) return 'Uploading video...';
    if (progress < 100) return 'Finalizing...';
    return 'Upload complete!';
  };

  return (
    <div className="bg-white rounded-lg border border-loom-border p-8">
      <div className="max-w-md mx-auto text-center">
        <div className="w-16 h-16 mx-auto mb-6 relative">
          <svg viewBox="0 0 64 64" className="w-full h-full">
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="#E5E5E5"
              strokeWidth="4"
            />
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="#625DF5"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 28}
              strokeDashoffset={2 * Math.PI * 28 * (1 - progress / 100)}
              transform="rotate(-90 32 32)"
              className="transition-all duration-300"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-loom-primary">
            {progress}%
          </div>
        </div>

        <h3 className="text-lg font-medium text-loom-text mb-2">{getLabel()}</h3>

        <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
          <div
            className="bg-loom-primary h-2 rounded-full upload-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
