/**
 * InlineFormTypeahead - Typeahead input for use in forms.
 */
import { useRef } from 'react';
import { useTypeahead } from '../../hooks/useTypeahead.js';
import type { InlineFormTypeaheadProps } from './types.js';

export function InlineFormTypeahead({
  name,
  required = false,
  error,
  label,
  helperText,
  placeholder = 'Start typing...',
  userId,
  limit = 5,
  fuzzy = false,
  minChars = 1,
  debounceMs = 150,
  onSelect,
  onSubmit,
  className = '',
  disabled = false,
  autoFocus = false,
}: InlineFormTypeaheadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const typeahead = useTypeahead({
    debounceMs,
    limit,
    userId,
    fuzzy,
    minChars,
    onSelect,
    onSubmit,
  });

  const hasError = !!error;
  const inputId = name || 'inline-typeahead';

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Label */}
      {label && (
        <label
          htmlFor={inputId}
          className="block mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}

      {/* Input wrapper */}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          value={typeahead.query}
          onChange={(e) => typeahead.setQuery(e.target.value)}
          onKeyDown={typeahead.handleKeyDown}
          onFocus={() => {
            if (typeahead.suggestions.length > 0) {
              typeahead.setIsOpen(true);
            }
          }}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => typeahead.setIsOpen(false), 150);
          }}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          className={`w-full px-3 py-2 rounded-lg border transition-colors
            ${
              hasError
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
            }
            ${disabled ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : 'bg-white dark:bg-gray-900'}
            text-gray-900 dark:text-white placeholder-gray-400
            focus:outline-none focus:ring-2
          `}
          {...typeahead.inputProps}
        />

        {/* Loading spinner */}
        {typeahead.isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      {typeahead.isOpen && typeahead.suggestions.length > 0 && (
        <ul
          className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
          {...typeahead.listboxProps}
        >
          {typeahead.suggestions.map((suggestion, index) => (
            <li
              key={suggestion.phrase}
              onClick={() => typeahead.selectSuggestion(index)}
              className={`px-3 py-2 cursor-pointer transition-colors ${
                typeahead.highlightedIndex === index
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
              {...typeahead.getOptionProps(index)}
            >
              <div className="flex items-center justify-between">
                <span>{suggestion.phrase}</span>
                {suggestion.count > 0 && (
                  <span className="text-xs text-gray-400">
                    {suggestion.count.toLocaleString()} searches
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Helper text or error */}
      {(helperText || error) && (
        <p
          className={`mt-1.5 text-sm ${
            hasError ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {error || helperText}
        </p>
      )}

      {/* Hidden input for form submission */}
      <input type="hidden" name={`${name}_value`} value={typeahead.query} />
    </div>
  );
}
