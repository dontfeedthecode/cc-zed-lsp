/**
 * Tier B cursor resolution: where is the caret, structurally?
 *
 * This is the primary input to completion, and it is deliberately line-based
 * rather than AST-based. Completion fires in documents that do not parse — the
 * moment you type `effort:` and press space there is no value node in the YAML
 * tree to land on, and an AST-driven classifier silently returns nothing at
 * exactly the moment the user wanted help. A regex pass over the current line
 * plus an indent stack is always available, mid-keystroke, and is correct for
 * the shapes frontmatter actually takes.
 *
 * Tier A (the real YAML parse) is used for hover and diagnostics, which can
 * afford to bail on a broken document. See ../features/.
 */

export type ValueStyle = 'plain' | 'flow' | 'quoted';

interface Span {
  /** Offsets of the text a completion should replace. */
  replaceStart: number;
  replaceEnd: number;
  /** Text already typed, for filtering. */
  prefix: string;
}

export type CursorContext =
  | { kind: 'outside' }
  | ({ kind: 'fmKey'; indent: number; siblings: string[] } & Span)
  | ({ kind: 'fmValue'; key: string; path: string[]; style: ValueStyle } & Span)
  | ({ kind: 'fmSeqItem'; key: string; path: string[] } & Span)
  | ({ kind: 'fmNestedKey'; path: string[]; indent: number } & Span)
  | ({ kind: 'bodySubst'; braced: boolean } & Span)
  | ({ kind: 'fmSubst'; braced: boolean } & Span);

export interface FrontmatterBounds {
  bodyStart: number;
  bodyEnd: number;
  /** True when no closing fence has been typed yet. */
  unterminated: boolean;
}

const OPEN_FENCE = /^---[ \t]*\r?\n/;
const CLOSE_FENCE = /^---[ \t]*\r?$/;

/**
 * Locate the frontmatter block for cursor purposes.
 *
 * Mirrors the runtime rule that the opening `---` must be the first line. While
 * the closing fence is still missing we treat the rest of the buffer as
 * frontmatter, because that is what the user is in the middle of writing.
 */
export function frontmatterBounds(text: string): FrontmatterBounds | null {
  const open = OPEN_FENCE.exec(text);
  if (!open || open.index !== 0) return null;

  const bodyStart = open[0].length;
  let offset = bodyStart;
  for (const line of text.slice(bodyStart).split('\n')) {
    if (CLOSE_FENCE.test(line)) return { bodyStart, bodyEnd: offset, unterminated: false };
    offset += line.length + 1;
  }
  return { bodyStart, bodyEnd: text.length, unterminated: true };
}

function lineBoundsAt(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nl = text.indexOf('\n', offset);
  return { start, end: nl === -1 ? text.length : nl };
}

const KEY_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)\s*:/;

/**
 * Walk upwards accumulating the enclosing key path, by indentation.
 *
 * `hooks:` / `  PreToolUse:` / `    - matcher: x` needs to resolve to
 * ['hooks', 'PreToolUse'], and the only reliable signal mid-edit is indent.
 */
function keyPathAbove(text: string, lineStart: number, indent: number): string[] {
  const path: string[] = [];
  let want = indent;
  let cursor = lineStart;

  while (cursor > 0 && want > 0) {
    const prevEnd = cursor - 1;
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
    const line = text.slice(prevStart, prevEnd);
    cursor = prevStart;

    const m = KEY_LINE.exec(line);
    if (m && m[1]!.length < want) {
      path.unshift(m[2]!);
      want = m[1]!.length;
    }
    if (prevStart === 0) break;
  }
  return path;
}

/** Top-level keys already present, so completion can stop offering them. */
function topLevelKeys(text: string, bounds: FrontmatterBounds): string[] {
  const keys: string[] = [];
  for (const line of text.slice(bounds.bodyStart, bounds.bodyEnd).split('\n')) {
    const m = KEY_LINE.exec(line);
    if (m && m[1]!.length === 0) keys.push(m[2]!);
  }
  return keys;
}

// Digits are allowed so that typing `$0` keeps the positional items on offer.
const SUBST = /\$\{?([A-Za-z0-9_]+)?$/;

/** Resolve where the caret is. Never throws; returns `outside` when unsure. */
export function cursorContext(text: string, offset: number): CursorContext {
  const bounds = frontmatterBounds(text);
  const { start: lineStart, end: lineEnd } = lineBoundsAt(text, offset);
  const before = text.slice(lineStart, offset);
  const full = text.slice(lineStart, lineEnd);

  const subst = SUBST.exec(before);
  const braced = !!subst && before[before.length - (subst[1]?.length ?? 0) - 1] === '{';
  // Editors auto-close `{`, so `${` arrives as `${|}`. Replace through that
  // closing brace, or accepting `${CLAUDE_SKILL_DIR}` leaves a stray `}`.
  const closing = braced ? /^[A-Za-z0-9_]*\}/.exec(text.slice(offset, lineEnd)) : null;
  const substSpan = subst && {
    braced,
    replaceStart: lineStart + subst.index,
    replaceEnd: offset + (closing?.[0].length ?? 0),
    prefix: subst[0],
  };

  // --- body -----------------------------------------------------------------
  if (!bounds || offset <= bounds.bodyStart || offset > bounds.bodyEnd) {
    return substSpan ? { kind: 'bodySubst', ...substSpan } : { kind: 'outside' };
  }

  // --- substitution inside a value: "allowed-tools: Bash(${CLAUDE_|" --------
  // Checked before the value branches, which would otherwise treat `Bash(${`
  // as a tool-name prefix and offer nothing that matches it.
  if (substSpan && /^\s*(-|[A-Za-z_][A-Za-z0-9_.-]*\s*:)/.test(before)) {
    return { kind: 'fmSubst', ...substSpan };
  }

  // --- sequence item: "  - Re|" --------------------------------------------
  const seq = /^(\s*)-\s*(.*)$/.exec(before);
  if (seq) {
    const indent = seq[1]!.length;
    const typed = seq[2]!;
    const path = keyPathAbove(text, lineStart, indent + 1);
    return {
      kind: 'fmSeqItem',
      key: path[path.length - 1] ?? '',
      path,
      replaceStart: offset - typed.length,
      replaceEnd: Math.max(offset, lineEnd),
      prefix: typed,
    };
  }

  // --- value position: "effort: hi|" ---------------------------------------
  const kv = /^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)\s*:[ \t]*(.*)$/.exec(before);
  if (kv) {
    const indent = kv[1]!.length;
    const key = kv[2]!;
    const typed = kv[3]!;
    const path = [...keyPathAbove(text, lineStart, indent), key];

    // Flow sequence: only the segment after the last separator is replaced,
    // otherwise accepting a completion eats the items already written.
    const flowOpen = typed.lastIndexOf('[');
    if (flowOpen >= 0 && !typed.slice(flowOpen).includes(']')) {
      const segment = typed.slice(flowOpen + 1);
      const lastSep = Math.max(segment.lastIndexOf(','), -1);
      const frag = segment.slice(lastSep + 1);
      const lead = frag.length - frag.trimStart().length;
      return {
        kind: 'fmValue',
        key,
        path,
        style: 'flow',
        replaceStart: offset - frag.length + lead,
        replaceEnd: offset,
        prefix: frag.trimStart(),
      };
    }

    // Comma- or space-separated scalar list, e.g. `allowed-tools: Read, Gr|`
    const lastSep = Math.max(typed.lastIndexOf(','), typed.lastIndexOf(' '));
    const frag = lastSep >= 0 ? typed.slice(lastSep + 1) : typed;
    const quoted = /^["']/.test(frag);

    return {
      kind: 'fmValue',
      key,
      path,
      style: quoted ? 'quoted' : 'plain',
      replaceStart: offset - frag.length,
      replaceEnd: Math.max(offset, lineEnd),
      prefix: frag,
    };
  }

  // --- key position: "desc|" or "  Pre|" under hooks: ----------------------
  const keyish = /^(\s*)([A-Za-z0-9_.-]*)$/.exec(before);
  if (keyish) {
    const indent = keyish[1]!.length;
    const typed = keyish[2]!;
    const span = {
      replaceStart: offset - typed.length,
      replaceEnd: Math.max(offset, lineEnd),
      prefix: typed,
    };

    if (indent > 0) {
      return { kind: 'fmNestedKey', path: keyPathAbove(text, lineStart, indent), indent, ...span };
    }
    return { kind: 'fmKey', indent, siblings: topLevelKeys(text, bounds), ...span };
  }

  return { kind: 'outside' };
}
