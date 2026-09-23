/**
 * Minimal GFM pipe-table reader.
 *
 * Deliberately not a full markdown parser: we only need the upstream docs'
 * frontmatter and tools tables, and a dependency-free reader means the drift
 * check has no supply chain of its own.
 */

export interface PipeTable {
  headers: string[];
  rows: string[][];
}

/**
 * Split one table row into cells.
 *
 * Splits on `|` only when it is neither backslash-escaped nor inside a backtick
 * span. This matters: real cells contain things like `<mobile|desktop|both>`
 * inside code spans, and naive splitting silently shears them in half.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  let tickRun = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '`') {
      tickRun++;
      inCode = !inCode;
      cur += ch;
      continue;
    }
    tickRun = 0;
    if (ch === '|' && !inCode) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);

  // A pipe table row is fenced by leading and trailing pipes, which produce
  // empty cells at both ends.
  if (cells.length && cells[0]!.trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

const DELIMITER_ROW = /^\|?[\s:|-]+\|[\s:|-]*$/;

function isDelimiterRow(line: string): boolean {
  return DELIMITER_ROW.test(line.trim()) && line.includes('-');
}

/**
 * Find the first pipe table at or after `startLine`.
 * Returns null when there is no table, which the caller treats as a FETCH-class
 * failure rather than an empty result.
 */
export function findTable(lines: string[], startLine = 0): PipeTable | null {
  for (let i = startLine; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const next = lines[i + 1]!;
    if (!line.trim().startsWith('|')) continue;
    if (!isDelimiterRow(next)) continue;

    const headers = splitRow(line);
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j]!;
      if (!row.trim().startsWith('|')) break;
      rows.push(splitRow(row));
    }
    return { headers, rows };
  }
  return null;
}

/** Locate a `#`-heading by its text, returning its line index. */
export function findHeading(lines: string[], heading: string): number {
  const needle = heading.trim().toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,6}\s+(.*)$/.exec(lines[i]!);
    if (m && m[1]!.trim().toLowerCase() === needle) return i;
  }
  return -1;
}

/** Every backticked token in a cell, order-preserved and deduped. */
export function codeTokens(cell: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const tok = m[1]!.trim();
    if (tok && !seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

/** Strip backticks from a single fully-code-spanned cell, e.g. `` `name` `` -> name. */
export function unwrapCode(cell: string): string {
  const m = /^`([^`]+)`$/.exec(cell.trim());
  return m ? m[1]!.trim() : cell.trim();
}
