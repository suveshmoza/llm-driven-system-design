const BINDING_REGEX = /\{\{\s*(.*?)\s*\}\}/g;

/**
 * Parse all {{ expression }} bindings from a text string.
 */
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
 * Check if a string contains binding expressions.
 */
export function hasBindings(text: string): boolean {
  return new RegExp(BINDING_REGEX.source).test(text);
}

/**
 * Resolve a property path from a context object.
 * Handles "query1.data[0].name" style paths.
 */
function resolvePropertyPath(path: string, context: Record<string, unknown>): unknown {
  const segments = path
    .replace(/\[(\w+)\]/g, '.$1')
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

/**
 * Resolve all {{ }} bindings in text, replacing them with context values.
 */
export function resolveBindings(
  text: string,
  context: Record<string, unknown>,
): string {
  return text.replace(BINDING_REGEX, (_match, expression: string) => {
    const value = resolvePropertyPath(expression.trim(), context);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Resolve a single binding expression and return the raw value.
 * Useful for props that need objects/arrays (like table data).
 */
export function resolveBindingValue(
  expression: string,
  context: Record<string, unknown>,
): unknown {
  // Remove {{ }} wrapper if present
  const cleaned = expression.replace(/^\{\{\s*|\s*\}\}$/g, '').trim();
  return resolvePropertyPath(cleaned, context);
}

/**
 * Get binding segments from text for syntax highlighting.
 * Returns array of { text, isBinding } segments.
 */
export function getBindingSegments(
  text: string,
): { text: string; isBinding: boolean }[] {
  const segments: { text: string; isBinding: boolean }[] = [];
  const regex = new RegExp(BINDING_REGEX.source, BINDING_REGEX.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isBinding: false });
    }
    segments.push({ text: match[0], isBinding: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isBinding: false });
  }

  return segments;
}
