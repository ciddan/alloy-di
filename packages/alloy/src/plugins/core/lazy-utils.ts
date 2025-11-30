/**
 * Removes every syntactic `Lazy(...)` segment from a dependency list string while preserving
 * surrounding commas / whitespace. This is used so we can separately treat eagerly referenced
 * service identifiers versus lazily imported ones.
 *
 * Implementation performs a lightweight single-pass scan with parenthesis depth tracking to
 * safely skip nested parentheses inside the Lazy callback (e.g. arrow functions, chained calls).
 *
 * Example:
 *  Input:  "A, Lazy(() => import('./b').then(m => m.B)), C"
 *  Output: "A, , C"  (Lazy segment stripped, leaving structural comma positions intact)
 *
 * NOTE: This intentionally does not attempt full JS parsing for performance; relies on balanced
 * parentheses inside the Lazy(...) expression.
 *
 * @param text Raw snippet extracted from decorator options containing potential Lazy(...) calls.
 * @returns Text with all Lazy(...) segments removed.
 */
// Detects the start of a Lazy(...) invocation while allowing for whitespace after the identifier.
const LAZY_PATTERN = /Lazy\s*\(/g;

export function stripLazySections(text: string): string {
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = LAZY_PATTERN.exec(text))) {
    result += text.slice(cursor, match.index);
    const openIndex = match.index + match[0].length - 1; // position of '('
    const closeIndex = findBalancedParen(text, openIndex);
    if (closeIndex === -1) {
      // Unbalanced expression; drop remainder to avoid infinite loop.
      cursor = text.length;
      break;
    }
    cursor = closeIndex + 1;
  }

  result += text.slice(cursor);
  return result;
}

// Walks forward from the provided opening parenthesis index until the matching closing paren.
function findBalancedParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
