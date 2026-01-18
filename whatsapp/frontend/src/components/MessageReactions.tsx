/**
 * Message Reactions Component
 *
 * Displays reaction badges on messages and handles reaction interactions.
 */

export interface ReactionSummary {
  emoji: string;
  count: number;
  userReacted: boolean;
}

interface MessageReactionsProps {
  reactions: ReactionSummary[];
  onToggleReaction: (emoji: string) => void;
}

/**
 * Displays a row of reaction badges for a message.
 */
export function MessageReactions({ reactions, onToggleReaction }: MessageReactionsProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          onClick={() => onToggleReaction(reaction.emoji)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors ${
            reaction.userReacted
              ? 'bg-whatsapp-teal/20 border border-whatsapp-teal'
              : 'bg-gray-100 hover:bg-gray-200 border border-transparent'
          }`}
        >
          <span>{reaction.emoji}</span>
          <span className="text-xs text-gray-600">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}
