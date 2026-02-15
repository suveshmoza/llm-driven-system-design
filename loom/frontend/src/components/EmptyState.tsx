interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Renders a centered empty state message with optional call-to-action button. */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 mx-auto mb-4 text-loom-secondary opacity-40">
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full">
          <rect x="8" y="12" width="48" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
          <polygon points="28,22 40,28 28,34" fill="currentColor" />
          <path d="M24 52h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M32 44v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-loom-text mb-2">{title}</h3>
      <p className="text-sm text-loom-secondary mb-6">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-6 py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover font-medium"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
