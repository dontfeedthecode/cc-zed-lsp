import { createHash } from 'node:crypto';
import type { ExtractedArtifact } from './extractors/fields.ts';
import type { ExtractedTool } from './extractors/tools.ts';

export type DriftClass = 'HARD' | 'SOFT';

export interface DriftFinding {
  cls: DriftClass;
  message: string;
}

export interface LockArtifact {
  fieldOrder: string[];
  fields: Record<string, { required: string; descSha256: string; codeTokens: string[] }>;
}

export interface Lock {
  lockVersion: number;
  sources: Record<string, { url: string; sha256: string; bytes: number }>;
  artifacts: Record<string, LockArtifact>;
  toolNames: string[];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function buildLockArtifact(a: ExtractedArtifact): LockArtifact {
  const fields: LockArtifact['fields'] = {};
  for (const [name, f] of Object.entries(a.fields)) {
    fields[name] = {
      required: f.required,
      descSha256: sha(f.descriptionRaw),
      codeTokens: f.codeTokens,
    };
  }
  return { fieldOrder: Object.keys(a.fields), fields };
}

export interface CuratedView {
  /** Field name -> static enum values we have hand-curated. */
  enums: Record<string, readonly string[]>;
  /** Every field name the curated layer knows about, documented or not. */
  known: ReadonlySet<string>;
}

/**
 * Classify what changed upstream.
 *
 * The design point: we never parse prose into an enum, but we do compare the
 * backticked-token set against curated truth. That catches the drift a field-set
 * diff misses — a value added to or removed from an enum — without ever having
 * to understand a sentence.
 */
export function classifyDrift(
  artifact: string,
  fresh: ExtractedArtifact,
  lockArtifact: LockArtifact | undefined,
  curated: CuratedView,
): DriftFinding[] {
  const out: DriftFinding[] = [];
  const freshNames = new Set(Object.keys(fresh.fields));

  // --- field set -----------------------------------------------------------
  if (lockArtifact) {
    const lockNames = new Set(Object.keys(lockArtifact.fields));
    for (const name of freshNames) {
      if (!lockNames.has(name)) {
        out.push({
          cls: 'HARD',
          message: `${artifact}: new field \`${name}\` upstream. Add it to the curated layer (type, enum, cross-field rules).`,
        });
      }
    }
    for (const name of lockNames) {
      if (!freshNames.has(name)) {
        out.push({
          cls: 'HARD',
          message: `${artifact}: field \`${name}\` removed upstream. Remove it from the curated layer or confirm it still works.`,
        });
      }
    }
    for (const [name, f] of Object.entries(fresh.fields)) {
      const prev = lockArtifact.fields[name];
      if (!prev) continue;
      if (prev.required !== f.required) {
        out.push({
          cls: 'HARD',
          message: `${artifact}.${name}: Required changed "${prev.required}" -> "${f.required}".`,
        });
      }
      if (prev.descSha256 !== sha(f.descriptionRaw)) {
        out.push({
          cls: 'SOFT',
          message: `${artifact}.${name}: description text changed. Hover copy will refresh on regenerate.`,
        });
      }
    }
  }

  // --- the enum probe ------------------------------------------------------
  for (const [name, values] of Object.entries(curated.enums)) {
    const f = fresh.fields[name];
    if (!f) continue;
    const tokens = new Set(f.codeTokens);

    for (const v of values) {
      if (!tokens.has(v)) {
        out.push({
          cls: 'HARD',
          message: `${artifact}.${name}: curated value \`${v}\` no longer appears in the upstream description. It may have been removed.`,
        });
      }
    }
    // A new backticked token in a field we have curated is worth a human look:
    // it is often a new enum value, and sometimes just prose.
    const lockTokens = new Set(lockArtifact?.fields[name]?.codeTokens ?? f.codeTokens);
    for (const t of f.codeTokens) {
      if (!lockTokens.has(t) && !values.includes(t)) {
        out.push({
          cls: 'SOFT',
          message: `${artifact}.${name}: new token \`${t}\` in the upstream description — check whether it is a new accepted value.`,
        });
      }
    }
  }

  // --- curated fields that upstream no longer documents --------------------
  for (const name of curated.known) {
    if (!freshNames.has(name)) continue;
  }

  return out;
}

export function classifyToolDrift(fresh: ExtractedTool[], lock: Lock | null): DriftFinding[] {
  if (!lock?.toolNames?.length) return [];
  const freshNames = new Set(fresh.map((t) => t.name));
  const lockNames = new Set(lock.toolNames);
  const out: DriftFinding[] = [];
  for (const n of freshNames) {
    if (!lockNames.has(n)) out.push({ cls: 'HARD', message: `New built-in tool \`${n}\`.` });
  }
  for (const n of lockNames) {
    if (!freshNames.has(n)) out.push({ cls: 'HARD', message: `Built-in tool \`${n}\` removed.` });
  }
  return out;
}
