// Word Count Plugin
// Displays word and character counts in the status bar

import { manifest } from './manifest';
import { WordCount } from './WordCount';

export { manifest, WordCount };

/** Activates the word count plugin (no initialization needed). */
export function activate(): void {
  console.log('[word-count] Plugin activated');
}
