/**
 * CommandPalette - Cmd+K style command palette with typeahead.
 */
import { useEffect, useCallback, useRef, useState } from 'react';
import { useTypeahead } from '../../hooks/useTypeahead.js';
import type { CommandPaletteProps, Command } from './types.js';

export function CommandPalette({
  shortcut = 'k',
  isOpen: controlledOpen,
  onOpenChange,
  categories = [],
  placeholder = 'Search or type a command...',
  userId,
  limit = 8,
  fuzzy = true,
  minChars = 1,
  debounceMs = 100,
  onSelect,
  onSubmit,
  className = '',
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const typeahead = useTypeahead({
    debounceMs,
    limit,
    userId,
    fuzzy,
    minChars,
    onSelect,
    onSubmit,
  });

  // Keyboard shortcut to open palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === shortcut) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcut, isOpen, setIsOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        typeahead.setQuery('');
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, setIsOpen, typeahead]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [isOpen, setIsOpen]);

  // Filter commands based on query
  const filteredCommands = useCallback(() => {
    if (!typeahead.query.trim()) {
      return categories.flatMap((cat) => cat.commands);
    }

    const query = typeahead.query.toLowerCase();
    const matches: Command[] = [];

    for (const category of categories) {
      for (const command of category.commands) {
        if (
          command.name.toLowerCase().includes(query) ||
          command.description?.toLowerCase().includes(query)
        ) {
          matches.push(command);
        }
      }
    }

    return matches.slice(0, limit);
  }, [typeahead.query, categories, limit]);

  const commands = filteredCommands();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50">
      <div
        ref={overlayRef}
        className={`w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden ${className}`}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={typeahead.query}
            onChange={(e) => typeahead.setQuery(e.target.value)}
            onKeyDown={typeahead.handleKeyDown}
            placeholder={placeholder}
            className="flex-1 px-3 py-4 text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-400"
            {...typeahead.inputProps}
          />
          {typeahead.isLoading && (
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          )}
        </div>

        {/* Results */}
        <div
          className="max-h-96 overflow-y-auto"
          {...typeahead.listboxProps}
        >
          {/* API Suggestions */}
          {typeahead.suggestions.length > 0 && (
            <div className="p-2">
              <div className="px-3 py-1 text-xs font-medium text-gray-500 uppercase">
                Suggestions
              </div>
              {typeahead.suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.phrase}
                  onClick={() => typeahead.selectSuggestion(index)}
                  className={`w-full flex items-center px-3 py-2 rounded-lg text-left ${
                    typeahead.highlightedIndex === index
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  {...typeahead.getOptionProps(index)}
                >
                  <svg
                    className="w-4 h-4 mr-3 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <span className="flex-1">{suggestion.phrase}</span>
                  {suggestion.score && (
                    <span className="text-xs text-gray-400">
                      {Math.round(suggestion.score * 100)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Commands */}
          {commands.length > 0 && (
            <div className="p-2 border-t border-gray-100 dark:border-gray-800">
              <div className="px-3 py-1 text-xs font-medium text-gray-500 uppercase">
                Commands
              </div>
              {commands.map((command) => (
                <button
                  key={command.id}
                  onClick={() => {
                    command.action();
                    setIsOpen(false);
                    typeahead.setQuery('');
                  }}
                  className="w-full flex items-center px-3 py-2 rounded-lg text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {command.icon && <span className="mr-3">{command.icon}</span>}
                  <div className="flex-1">
                    <div className="font-medium">{command.name}</div>
                    {command.description && (
                      <div className="text-sm text-gray-500">{command.description}</div>
                    )}
                  </div>
                  {command.shortcut && (
                    <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                      {command.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {typeahead.query.trim() &&
            typeahead.suggestions.length === 0 &&
            commands.length === 0 &&
            !typeahead.isLoading && (
              <div className="p-8 text-center text-gray-500">
                No results found for "{typeahead.query}"
              </div>
            )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">↑↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Enter</kbd> Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Esc</kbd> Close
            </span>
          </div>
          {typeahead.isCached && (
            <span className="text-blue-500">Cached</span>
          )}
        </div>
      </div>
    </div>
  );
}
