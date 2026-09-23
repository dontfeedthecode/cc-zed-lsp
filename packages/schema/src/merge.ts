import type { ArtifactKind, ArtifactSpec, Curation, FieldSpec } from './types.js';
import { SKILL_CURATION, SKILL_PORTABLE_FIELDS } from './curated/skill.fields.js';
import { UNDOCUMENTED_FIELDS } from './curated/undocumented.js';
import { SKILL_RULES } from './rules/index.js';
import extract from './generated/docs-extract.json' with { type: 'json' };

/**
 * The single join point between the generated docs extract and the curated
 * layer. Everything downstream consumes `ArtifactSpec` and never reaches past
 * it into either source.
 *
 * Docs supply: which fields exist, whether they're required, and the prose used
 * for hover. Curation supplies: types, enums, limits and cross-field rules —
 * the things the docs only express as prose. Where they disagree about a field
 * existing, the docs win for `documented`, and curation-only entries are
 * carried through as `undocumented` so they can be tolerated rather than
 * flagged as typos.
 */

interface ExtractField {
  order: number;
  required: string;
  descriptionMarkdown: string;
  codeTokens: string[];
}

function buildSpec(
  kind: ArtifactKind,
  curation: Record<string, Curation>,
  undocumented: Record<string, Curation>,
  portableFields: readonly string[],
  rules: ArtifactSpec['rules'],
): ArtifactSpec {
  const artifact = (extract.artifacts as Record<string, any>)[kind];
  const docsUrl: string = artifact?.docsAnchor ?? 'https://code.claude.com/docs/en/skills';
  const docFields: Record<string, ExtractField> = artifact?.fields ?? {};

  const fields = new Map<string, FieldSpec>();

  for (const [name, doc] of Object.entries(docFields)) {
    const cur = curation[name] ?? { type: 'unknown' as const };
    fields.set(name, {
      ...cur,
      name,
      provenance: 'documented',
      required: doc.required,
      documentation: doc.descriptionMarkdown,
      docsUrl,
      codeTokens: doc.codeTokens,
      tier: cur.tier ?? 5,
    });
  }

  // Curated fields the docs table doesn't list. Real, but Claude Code ignores
  // them — carried through so they get a Hint instead of an "unknown key" warning.
  for (const [name, cur] of Object.entries(undocumented)) {
    if (fields.has(name)) continue;
    fields.set(name, { ...cur, name, provenance: 'undocumented', docsUrl, tier: cur.tier ?? 9 });
  }

  return { kind, docsUrl, fields, portableFields, rules };
}

export const SKILL_SPEC: ArtifactSpec = buildSpec(
  'skill',
  SKILL_CURATION,
  UNDOCUMENTED_FIELDS,
  SKILL_PORTABLE_FIELDS,
  SKILL_RULES,
);

const SPECS: Partial<Record<ArtifactKind, ArtifactSpec>> = { skill: SKILL_SPEC };

export function specFor(kind: ArtifactKind): ArtifactSpec | undefined {
  return SPECS[kind];
}

/** The canonical built-in tool list, for `allowed-tools` completion. */
export const BUILTIN_TOOLS: readonly { name: string; descriptionMarkdown: string }[] =
  (extract.tools as { name: string; descriptionMarkdown: string }[]) ?? [];
