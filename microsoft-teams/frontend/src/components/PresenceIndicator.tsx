interface PresenceIndicatorProps {
  isOnline: boolean;
  size?: 'sm' | 'md';
}

/** Displays a colored dot indicating online (green) or offline (gray) status. */
export function PresenceIndicator({ isOnline, size = 'sm' }: PresenceIndicatorProps) {
  const sizeClasses = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <div
      className={`absolute -bottom-0.5 -right-0.5 ${sizeClasses} rounded-full border-2 border-teams-surface ${
        isOnline ? 'bg-teams-success' : 'bg-gray-400'
      }`}
    />
  );
}
