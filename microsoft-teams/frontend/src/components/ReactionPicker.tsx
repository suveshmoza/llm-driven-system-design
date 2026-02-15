interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
}

const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀', '✅', '🙏'];

/** Displays a horizontal row of common emoji reactions for quick selection. */
export function ReactionPicker({ onSelect }: ReactionPickerProps) {
  return (
    <div className="bg-teams-surface border border-teams-border rounded-lg shadow-lg p-2 flex gap-1">
      {COMMON_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-teams-bg rounded transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
