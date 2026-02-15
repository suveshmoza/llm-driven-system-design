/**
 * Binding Engine
 *
 * Parses and resolves {{ expression }} bindings used in component props and queries.
 * Uses safe property path resolution (no eval).
 *
 * Examples:
 *   "Hello {{ query1.data[0].name }}" -> "Hello Alice"
 *   "{{ textInput1.value }}" -> "search term"
 *   "SELECT * FROM customers WHERE name = '{{ searchInput.value }}'"
 */

const BINDING_REGEX = /\{\{\s*(.*?)\s*\}\}/g;

/** Extracts all {{ expression }} binding strings from a template. */
export function parseBindings(text: string): string[] {
  const bindings: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(BINDING_REGEX.source, BINDING_REGEX.flags);
  while ((match = regex.exec(text)) !== null) {
    bindings.push(match[1]);
  }
  return bindings;
}

/**
 * Resolve a property path like "query1.data[0].name" from a context object.
 * Handles dot notation and array bracket notation safely.
 */
function resolvePropertyPath(path: string, context: Record<string, unknown>): unknown {
  // Split path into segments: "query1.data[0].name" -> ["query1", "data", "0", "name"]
  const segments = path
    .replace(/\[(\w+)\]/g, '.$1') // Convert brackets to dots
    .split('.')
    .filter((s) => s.length > 0);

  let current: unknown = context;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/** Resolves template bindings (e.g. {{query1.data}}) against available data contexts. */
export function resolveBindings(
  text: string,
  context: Record<string, unknown>,
): string {
  return text.replace(BINDING_REGEX, (_match, expression: string) => {
    const trimmed = expression.trim();
    const value = resolvePropertyPath(trimmed, context);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Resolve a single binding expression and return the raw value (not stringified).
 * Useful for component props that need arrays/objects (like table data).
 */
export function resolveBindingValue(
  expression: string,
  context: Record<string, unknown>,
): unknown {
  const trimmed = expression.trim();
  return resolvePropertyPath(trimmed, context);
}

/**
 * Check if a string contains any binding expressions.
 */
export function hasBindings(text: string): boolean {
  return BINDING_REGEX.test(text);
}
