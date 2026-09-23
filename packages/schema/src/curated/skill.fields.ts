import type { Curation } from '../types.js';

/**
 * Curated facts about SKILL.md frontmatter that the upstream docs express only
 * as prose inside the Description column of the frontmatter reference table.
 *
 * Keep this keyed by field name and keep it dumb. The drift checker asserts that
 * every key here still exists upstream, and that every value in a static `enum`
 * still appears as a backticked token in that field's docs description.
 *
 * Source of truth: https://code.claude.com/docs/en/skills#frontmatter-reference
 */
export const SKILL_CURATION: Record<string, Curation> = {
  // --- identity -------------------------------------------------------------
  name: {
    type: 'string',
    maxLength: 64,
    pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    patternHint: 'lowercase letters, digits and single hyphens (kebab-case)',
    tier: 1,
  },
  description: {
    type: 'string',
    combinedCap: { with: 'when_to_use', max: 1536, configurableVia: 'skillListingMaxDescChars' },
    tier: 0,
  },
  when_to_use: {
    type: 'string',
    combinedCap: { with: 'description', max: 1536, configurableVia: 'skillListingMaxDescChars' },
    tier: 2,
  },

  // --- invocation -----------------------------------------------------------
  'argument-hint': { type: 'string', tier: 4 },
  arguments: { type: 'string-or-list', listSeparator: /[\s,]+/, tier: 4 },
  'disable-model-invocation': { type: 'boolean', default: false, tier: 5 },
  'user-invocable': { type: 'boolean', default: true, tier: 5 },

  // --- tool access ----------------------------------------------------------
  'allowed-tools': {
    type: 'string-or-list',
    dynamicEnum: 'tools',
    listSeparator: /[\s,]+/,
    tier: 3,
  },
  'disallowed-tools': {
    type: 'string-or-list',
    dynamicEnum: 'tools',
    listSeparator: /[\s,]+/,
    tier: 5,
  },

  // --- execution ------------------------------------------------------------
  // `model` is deliberately NOT an enum: the docs say "accepts the same values
  // as /model", which is an open set. Completion offers suggestions; validation
  // never rejects a value here.
  //
  // Deliberately NO `requires: { context: fork }`. The docs state the override
  // "applies for the rest of the current turn", i.e. fork is not required.
  // Observed behaviour disagrees (see rules/modelWithoutFork.ts), so that case
  // is reported as a Hint rather than encoded as a hard precondition here.
  model: { type: 'string', dynamicEnum: 'models', tier: 5 },
  effort: { type: 'enum', enum: ['low', 'medium', 'high', 'xhigh', 'max'], tier: 5 },
  context: { type: 'enum', enum: ['fork'], tier: 5 },
  agent: { type: 'string', dynamicEnum: 'agents', requires: { context: 'fork' }, tier: 6 },
  background: { type: 'boolean', default: true, requires: { context: 'fork' }, tier: 6 },
  shell: { type: 'enum', enum: ['bash', 'powershell'], default: 'bash', tier: 6 },

  // --- wiring ---------------------------------------------------------------
  hooks: { type: 'map', deferValidation: 'phase2', tier: 7 },
  paths: { type: 'string-or-list', listSeparator: /[\s,]+/, tier: 6 },

  // --- metadata -------------------------------------------------------------
  metadata: { type: 'map', freeForm: true, tier: 8 },
  license: { type: 'string', tier: 8 },
  compatibility: { type: 'string', maxLength: 500, tier: 8 },
};

/**
 * Keys accepted outside Claude Code — claude.ai uploads, the Skills API, and
 * packaging with package_skill.py. Any other key is a hard error in those
 * targets, which is why the portability lint exists.
 *
 * Mirrors ALLOWED_PROPERTIES in skill-creator's quick_validate.py.
 */
export const SKILL_PORTABLE_FIELDS = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
] as const;

/**
 * Extra constraints that only apply under the portable profile. The Claude Code
 * runtime is more permissive than the Agent Skills spec validator.
 */
export const SKILL_PORTABLE_CONSTRAINTS = {
  description: { maxLength: 1024, denyChars: ['<', '>'] },
} as const;
