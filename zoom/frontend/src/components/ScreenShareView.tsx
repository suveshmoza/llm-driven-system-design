export function ScreenShareView({ displayName }: { displayName: string }) {
  return (
    <div className="w-full h-full bg-zoom-surface rounded-lg flex items-center justify-center relative">
      <div className="text-center">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="#2D8CFF" className="mx-auto mb-4">
          <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
        </svg>
        <p className="text-zoom-text text-lg font-medium">{displayName} is sharing their screen</p>
        <p className="text-zoom-secondary text-sm mt-1">Screen content would appear here in production</p>
      </div>
    </div>
  );
}
