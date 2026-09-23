import type { Curation } from '../types.js';

/**
 * Keys that appear in real, shipped skills but are absent from the upstream
 * frontmatter reference table.
 *
 * These must never produce an Error. A census of the 46 SKILL.md files under
 * ~/.claude found `version` in 13 of them and `tools` in 2 — including
 * first-party Anthropic plugin skills. A strict validator would light up the
 * official marketplace, which would train users to ignore our diagnostics.
 *
 * `tools` is the interesting case: it is subagent frontmatter, so its presence
 * in a SKILL.md is most likely an authoring mistake rather than a real alias.
 * We warn about that one specifically (see rules/toolsNotAllowedTools.ts);
 * everything else here is a Hint at most.
 */
export const UNDOCUMENTED_FIELDS: Record<string, Curation> = {
  version: {
    type: 'string',
    note: 'Widely used in practice — 13 of the 46 skills in our census set it — but Claude Code does not read it.',
    tier: 9,
  },
  author: { type: 'string', note: 'Community convention; Claude Code ignores it.', tier: 9 },
  tags: { type: 'string-or-list', note: 'Community convention; consider metadata.tags.', tier: 9 },
  category: { type: 'string', note: 'Community convention; consider metadata.category.', tier: 9 },
  title: { type: 'string', note: 'Community convention; the documented key is `name`.', tier: 9 },
  homepage: { type: 'string', note: 'Community convention; Claude Code ignores it.', tier: 9 },
  keywords: { type: 'string-or-list', note: 'Community convention; Claude Code ignores it.', tier: 9 },
};

/**
 * Keys that belong to a *different* artifact type. Presence in a SKILL.md is
 * nearly always a copy-paste error, so these get a targeted message naming the
 * field the author probably meant.
 */
export const MISPLACED_FIELDS: Record<string, { from: string; useInstead?: string }> = {
  tools: { from: 'subagent', useInstead: 'allowed-tools' },
  color: { from: 'subagent' },
  permissionMode: { from: 'subagent' },
  maxTurns: { from: 'subagent' },
  isolation: { from: 'subagent' },
  memory: { from: 'subagent' },
  initialPrompt: { from: 'subagent' },
  'hide-from-slash-command-tool': { from: 'slash command' },
  'keep-coding-instructions': { from: 'output style' },
};
