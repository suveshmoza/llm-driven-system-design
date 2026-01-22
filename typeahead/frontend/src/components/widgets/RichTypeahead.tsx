/**
 * RichTypeahead - Typeahead with metadata, thumbnails, and score breakdown.
 */
import { useRef } from 'react';
import { useTypeahead } from '../../hooks/useTypeahead.js';
import type { RichTypeaheadProps } from './types.js';
import type { Suggestion } from '../../types';

export function RichTypeahead({
  placeholder = 'Search...',
  userId,
  limit = 8,
  fuzzy = false,
  minChars = 1,
  debounceMs = 150,
  showMetadata = true,
  showThumbnails = false,
  showScores = false,
  getThumbnail,
  renderSuggestion,
  onSelect,
  onSubmit,
  className = '',
  disabled = false,
  autoFocus = false,
}: RichTypeaheadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const typeahead = useTypeahead({
    debounceMs,
    limit,
    userId,
    fuzzy,
    minChars,
    onSelect,
    onSubmit,
  });

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => typeahead.setIsOpen(false), 200);
  };

  const defaultRenderSuggestion = (suggestion: Suggestion, index: number) => {
    const thumbnail = getThumbnail?.(suggestion);

    return (
      <div
        key={suggestion.phrase}
        onClick={() => typeahead.selectSuggestion(index)}
        className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${
          typeahead.highlightedIndex === index
            ? 'bg-blue-50 dark:bg-blue-900/30'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
        {...typeahead.getOptionProps(index)}
      >
        {/* Thumbnail */}
        {showThumbnails && (
          <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div
            className={`font-medium truncate ${
              typeahead.highlightedIndex === index
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-gray-900 dark:text-white'
            }`}
          >
            {suggestion.phrase}
          </div>

          {/* Metadata row */}
          {showMetadata && (
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{suggestion.count.toLocaleString()} searches</span>
              {suggestion.lastUpdated && (
                <>
                  <span>•</span>
                  <span>{formatTimeAgo(suggestion.lastUpdated)}</span>
                </>
              )}
              {suggestion.isFuzzy && (
                <>
                  <span>•</span>
                  <span className="text-amber-500">Fuzzy match</span>
                </>
              )}
            </div>
          )}

          {/* Score breakdown */}
          {showScores && suggestion.scores && (
            <div className="flex items-center gap-2 mt-2">
              <ScoreBadge label="Pop" value={suggestion.scores.popularity} color="blue" />
              <ScoreBadge label="Rec" value={suggestion.scores.recency} color="green" />
              <ScoreBadge label="Per" value={suggestion.scores.personal} color="purple" />
              <ScoreBadge label="Trn" value={suggestion.scores.trending} color="orange" />
              <ScoreBadge label="Mat" value={suggestion.scores.match} color="gray" />
            </div>
          )}
        </div>

        {/* Overall score */}
        {suggestion.score !== undefined && (
          <div className="flex-shrink-0 text-right">
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              {Math.round(suggestion.score * 100)}
            </div>
            <div className="text-xs text-gray-500">score</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Search input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={typeahead.query}
          onChange={(e) => typeahead.setQuery(e.target.value)}
          onKeyDown={typeahead.handleKeyDown}
          onFocus={() => {
            if (typeahead.suggestions.length > 0) {
              typeahead.setIsOpen(true);
            }
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className="w-full pl-10 pr-10 py-3 text-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
          {...typeahead.inputProps}
        />

        {/* Loading / cached indicator */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {typeahead.isLoading && (
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          )}
          {typeahead.isCached && !typeahead.isLoading && (
            <span className="text-xs text-blue-500 font-medium">Cached</span>
          )}
        </div>
      </div>

      {/* Suggestions dropdown */}
      {typeahead.isOpen && typeahead.suggestions.length > 0 && (
        <div
          className="absolute z-20 w-full mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-[70vh] overflow-y-auto"
          {...typeahead.listboxProps}
        >
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {typeahead.suggestions.map((suggestion, index) =>
              renderSuggestion
                ? renderSuggestion(suggestion, index)
                : defaultRenderSuggestion(suggestion, index)
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
            <span>{typeahead.suggestions.length} results</span>
            <span>
              <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">
                ↑↓
              </kbd>{' '}
              to navigate
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {typeahead.error && (
        <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">
            {typeahead.error.message}
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'gray';
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colorClasses[color]}`}>
      {label}: {(value * 100).toFixed(0)}
    </span>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}
