import { parseDocument, LineCounter, isMap, isScalar, isSeq, type Document } from 'yaml';
import type { Finding, ParsedField } from './types.js';

/**
 * Structural parse of an artifact's frontmatter.
 *
 * Lives here rather than in the server because it is pure: the CLI linter, the
 * corpus test and the language server all need the same field spans. The
 * cursor-context classifier used for completion is a different problem with
 * different failure tolerances, and stays in the server.
 *
 * Every offset returned is in DOCUMENT space, not frontmatter space. The
 * conversion happens once, here, and nothing downstream repeats it.
 */

export interface FrontmatterSplit {
  /** Offset of the first character after the opening `---` line. */
  bodyStart: number;
  /** Offset of the character before the closing `---` line. */
  bodyEnd: number;
  /** Offset just past the closing fence, where skill content begins. */
  contentStart: number;
  text: string;
}

export interface ParseResult {
  split: FrontmatterSplit | null;
  fields: Map<string, ParsedField>;
  /** Structural problems: missing fence, unparseable YAML, duplicate keys. */
  findings: Finding[];
  /** True when the YAML parsed cleanly enough to trust `fields`. */
  ok: boolean;
}

const OPEN_FENCE = /^---[ \t]*\r?\n/;
const CLOSE_FENCE = /^---[ \t]*$/;

/**
 * Locate the frontmatter block.
 *
 * Claude Code reads frontmatter only when the opening `---` is the file's very
 * first line; otherwise the whole file, fences included, is treated as content.
 * That rule is reproduced exactly, because a file that silently becomes content
 * is the single most expensive mistake in this format.
 */
export function splitFrontmatter(text: string): FrontmatterSplit | null {
  const open = OPEN_FENCE.exec(text);
  if (!open || open.index !== 0) return null;

  const bodyStart = open[0].length;
  const lines = text.slice(bodyStart).split('\n');

  let offset = bodyStart;
  for (const line of lines) {
    if (CLOSE_FENCE.test(line.replace(/\r$/, ''))) {
      return {
        bodyStart,
        bodyEnd: offset,
        contentStart: offset + line.length + 1,
        text: text.slice(bodyStart, offset),
      };
    }
    offset += line.length + 1;
  }
  return { bodyStart, bodyEnd: text.length, contentStart: text.length, text: text.slice(bodyStart) };
}

/** Does the file look like it *meant* to have frontmatter but misplaced the fence? */
export function hasMisplacedOpeningFence(text: string): number | null {
  if (OPEN_FENCE.test(text)) return null;
  const idx = text.indexOf('\n---');
  if (idx < 0) return null;
  // Only worth reporting when the preamble is short — a `---` deep in a long
  // document is a horizontal rule, not a misplaced fence.
  const preamble = text.slice(0, idx);
  if (preamble.length > 200 || preamble.split('\n').length > 5) return null;
  return idx + 1;
}

function collectFields(doc: Document, base: number, lc: LineCounter): {
  fields: Map<string, ParsedField>;
  duplicates: ParsedField[];
} {
  const fields = new Map<string, ParsedField>();
  const duplicates: ParsedField[] = [];
  const contents = doc.contents;
  if (!isMap(contents)) return { fields, duplicates };

  for (const item of contents.items) {
    const keyNode = item.key;
    if (!isScalar(keyNode) || typeof keyNode.value !== 'string') continue;

    const key = keyNode.value;
    const kr = keyNode.range;
    const valNode = item.value as any;
    const vr = valNode?.range as [number, number, number] | undefined;

    const parsed: ParsedField = {
      key,
      keyStart: base + (kr?.[0] ?? 0),
      keyEnd: base + (kr?.[1] ?? 0),
      value: valNode == null ? undefined : (isScalar(valNode) ? valNode.value : valNode.toJSON?.()),
      ...(vr ? { valueStart: base + vr[0], valueEnd: base + vr[1] } : {}),
      ...(isScalar(valNode) && typeof valNode.source === 'string' ? { raw: valNode.source } : {}),
    };

    // Seq values come back from toJSON as arrays, which is what the rules want.
    if (isSeq(valNode)) parsed.value = valNode.toJSON();

    if (fields.has(key)) duplicates.push(parsed);
    else fields.set(key, parsed);
  }
  return { fields, duplicates };
}

export function parseFrontmatter(text: string): ParseResult {
  const findings: Finding[] = [];
  const split = splitFrontmatter(text);

  if (!split) {
    const misplaced = hasMisplacedOpeningFence(text);
    if (misplaced !== null) {
      findings.push({
        code: 'fence-not-first-line',
        severity: 'error',
        message:
          'Frontmatter is ignored: the opening `---` must be the file\'s first line. As written, Claude Code treats this entire file — fences included — as skill content.',
        start: 0,
        end: Math.min(misplaced, text.length),
      });
    }
    return { split: null, fields: new Map(), findings, ok: false };
  }

  if (split.contentStart >= text.length && split.bodyEnd >= text.length) {
    findings.push({
      code: 'unterminated-frontmatter',
      severity: 'error',
      message: 'Frontmatter has no closing `---`.',
      start: 0,
      end: Math.min(3, text.length),
    });
    return { split, fields: new Map(), findings, ok: false };
  }

  const lc = new LineCounter();
  const doc = parseDocument(split.text, { lineCounter: lc, keepSourceTokens: true });

  for (const err of doc.errors) {
    findings.push({
      code: 'yaml-error',
      severity: 'error',
      message: err.message,
      start: split.bodyStart + err.pos[0],
      end: split.bodyStart + err.pos[1],
    });
  }

  const { fields, duplicates } = collectFields(doc, split.bodyStart, lc);
  for (const dup of duplicates) {
    findings.push({
      code: 'duplicate-key',
      severity: 'error',
      message: `Duplicate key \`${dup.key}\`. The last occurrence wins.`,
      start: dup.keyStart,
      end: dup.keyEnd,
    });
  }

  return { split, fields, findings, ok: doc.errors.length === 0 };
}
