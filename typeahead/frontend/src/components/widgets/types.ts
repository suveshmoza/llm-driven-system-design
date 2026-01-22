/**
 * Widget type definitions for typeahead components.
 */
import type { Suggestion } from '../../types';

export interface BaseTypeaheadProps {
  /** Placeholder text */
  placeholder?: string;
  /** User ID for personalization */
  userId?: string;
  /** Maximum suggestions to show */
  limit?: number;
  /** Enable fuzzy matching */
  fuzzy?: boolean;
  /** Minimum characters to trigger search */
  minChars?: number;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Callback when suggestion is selected */
  onSelect?: (phrase: string) => void;
  /** Callback when search is submitted */
  onSubmit?: (query: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Auto focus on mount */
  autoFocus?: boolean;
}

export interface CommandPaletteProps extends BaseTypeaheadProps {
  /** Keyboard shortcut to open (default: Cmd+K) */
  shortcut?: string;
  /** Whether palette is open */
  isOpen?: boolean;
  /** Callback to set open state */
  onOpenChange?: (open: boolean) => void;
  /** Command categories */
  categories?: CommandCategory[];
}

export interface CommandCategory {
  id: string;
  name: string;
  icon?: React.ReactNode;
  commands: Command[];
}

export interface Command {
  id: string;
  name: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export interface RichTypeaheadProps extends BaseTypeaheadProps {
  /** Show metadata in suggestions */
  showMetadata?: boolean;
  /** Show thumbnails */
  showThumbnails?: boolean;
  /** Show score breakdown */
  showScores?: boolean;
  /** Thumbnail URL getter */
  getThumbnail?: (suggestion: Suggestion) => string | undefined;
  /** Custom render for suggestion */
  renderSuggestion?: (suggestion: Suggestion, index: number) => React.ReactNode;
}

export interface InlineFormTypeaheadProps extends BaseTypeaheadProps {
  /** Form field name */
  name?: string;
  /** Required field */
  required?: boolean;
  /** Error message */
  error?: string;
  /** Label text */
  label?: string;
  /** Helper text */
  helperText?: string;
}

export interface MobileTypeaheadProps extends BaseTypeaheadProps {
  /** Title for mobile overlay */
  title?: string;
  /** Show cancel button */
  showCancel?: boolean;
  /** Cancel button text */
  cancelText?: string;
  /** Whether to show as full screen */
  fullScreen?: boolean;
}

export interface SuggestionItemProps {
  suggestion: Suggestion;
  index: number;
  isHighlighted: boolean;
  onClick: () => void;
  showMetadata?: boolean;
  showScores?: boolean;
  optionProps: {
    role: 'option';
    id: string;
    'aria-selected': boolean;
  };
}
