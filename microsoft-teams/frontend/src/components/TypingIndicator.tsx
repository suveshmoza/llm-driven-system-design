interface TypingIndicatorProps {
  users: string[];
}

/** Displays an animated typing indicator showing which users are currently typing. */
export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null;

  let text = '';
  if (users.length === 1) {
    text = `${users[0]} is typing...`;
  } else if (users.length === 2) {
    text = `${users[0]} and ${users[1]} are typing...`;
  } else {
    text = `${users[0]} and ${users.length - 1} others are typing...`;
  }

  return (
    <div className="px-4 py-1 flex items-center gap-2 text-xs text-teams-secondary">
      <div className="flex gap-0.5">
        <span className="w-1.5 h-1.5 bg-teams-secondary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-teams-secondary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-teams-secondary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
