import type { Finding, ParsedField, Severity } from '../types.js';

export function finding(
  code: string,
  severity: Severity,
  message: string,
  span: { start: number; end: number },
  extra: Partial<Finding> = {},
): Finding {
  return { code, severity, message, start: span.start, end: span.end, ...extra };
}

/** Span covering a field's key token. */
export const keySpan = (f: ParsedField) => ({ start: f.keyStart, end: f.keyEnd });

/** Span covering a field's value, falling back to the key when there is none. */
export const valueSpan = (f: ParsedField) =>
  f.valueStart !== undefined && f.valueEnd !== undefined
    ? { start: f.valueStart, end: f.valueEnd }
    : keySpan(f);

/** Accepted boolean spellings. Claude Code takes all of these, case-insensitively. */
export const BOOLEAN_WORDS = ['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'];

export function isBooleanLike(raw: string | undefined, value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (raw === undefined) return false;
  return BOOLEAN_WORDS.includes(raw.trim().toLowerCase());
}

/** Levenshtein distance, capped for speed — we only care about <= 2. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function nearestNames(name: string, candidates: Iterable<string>, max = 2): string[] {
  const scored: { n: string; d: number }[] = [];
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d <= max) scored.push({ n: c, d });
  }
  return scored.sort((x, y) => x.d - y.d).slice(0, 3).map((s) => s.n);
}

/** Flatten a `string-or-list` field into its items, whatever syntax was used. */
export function listItems(f: ParsedField, sep: RegExp): string[] {
  if (Array.isArray(f.value)) return f.value.filter((v) => typeof v === 'string') as string[];
  if (typeof f.value === 'string') return f.value.split(sep).filter(Boolean);
  return [];
}
