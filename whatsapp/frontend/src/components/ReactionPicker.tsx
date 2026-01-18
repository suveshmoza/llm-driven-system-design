/**
 * Reaction Picker Component
 *
 * Popup for selecting emoji reactions on messages.
 * Shows allowed emojis in a horizontal bar.
 */

import { useEffect, useRef } from 'react';

interface ReactionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  position?: { x: number; y: number };
}

/**
 * Allowed emoji reactions (matches backend).
 */
const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '😢', '😠', '👍'];

/**
 * Emoji picker popup for message reactions.
 */
export function ReactionPicker({ isOpen, onClose, onSelect, position }: ReactionPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const style = position
    ? {
        position: 'fixed' as const,
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%)',
      }
    : {};

  return (
    <div
      ref={pickerRef}
      className="z-50 bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1 flex gap-1"
      style={style}
    >
      {ALLOWED_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => {
            onSelect(emoji);
            onClose();
          }}
          className="p-1.5 hover:bg-gray-100 rounded-full transition-colors text-xl hover:scale-125 transform"
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
