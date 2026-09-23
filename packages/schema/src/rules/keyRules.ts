import type { Finding, Rule } from '../types.js';
import { finding, keySpan, valueSpan, nearestNames } from './helpers.js';
import { MISPLACED_FIELDS } from '../curated/undocumented.js';
import { SKILL_PORTABLE_CONSTRAINTS } from '../curated/skill.fields.js';

/**
 * A key we have never heard of.
 *
 * Warning with a did-you-mean, never Error. A census of the 46 SKILL.md files
 * shipped under ~/.claude found unrecognised keys in a third of them, including
 * first-party Anthropic plugin skills. Erroring on those would train users to
 * ignore the squiggles entirely, which costs us every other diagnostic.
 */
export const unknownKey: Rule = {
  id: 'unknown-key',
  run(ctx) {
    const out: Finding[] = [];
    const documented = [...ctx.spec.fields.values()]
      .filter((f) => f.provenance === 'documented')
      .map((f) => f.name);

    for (const [name, f] of ctx.fields) {
      if (ctx.spec.fields.has(name)) continue;
      if (MISPLACED_FIELDS[name]) continue; // handled with a better message below

      const suggestions = nearestNames(name, documented);
      out.push(
        finding(
          'unknown-key',
          'warning',
          suggestions.length
            ? `Claude Code doesn't recognise \`${name}\`. Did you mean \`${suggestions[0]}\`?`
            : `Claude Code doesn't recognise \`${name}\`; it will be ignored.`,
          keySpan(f),
          {
            href: ctx.spec.docsUrl,
            data: suggestions.length
              ? { suggestions, renameTo: suggestions[0] }
              : undefined,
          },
        ),
      );
    }
    return out;
  },
};

/**
 * A key that belongs to a different artifact type. Nearly always a copy-paste
 * from a subagent or slash-command file, so name the likely intent.
 */
export const misplacedKey: Rule = {
  id: 'misplaced-key',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const misplaced = MISPLACED_FIELDS[name];
      if (!misplaced) continue;
      if (ctx.spec.fields.has(name) && ctx.spec.fields.get(name)!.provenance === 'documented') continue;

      out.push(
        finding(
          'misplaced-key',
          'warning',
          misplaced.useInstead
            ? `\`${name}\` is ${misplaced.from} frontmatter. In a skill, use \`${misplaced.useInstead}\`.`
            : `\`${name}\` is ${misplaced.from} frontmatter and has no effect in a skill.`,
          keySpan(f),
          {
            href: ctx.spec.docsUrl,
            data: misplaced.useInstead ? { renameTo: misplaced.useInstead } : undefined,
          },
        ),
      );
    }
    return out;
  },
};

/** Real-but-undocumented keys, e.g. `version`. Quiet by design. */
export const undocumentedKey: Rule = {
  id: 'undocumented-key',
  run(ctx) {
    if (ctx.options.reportUndocumented === false) return [];

    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (spec?.provenance !== 'undocumented') continue;

      out.push(
        finding(
          'undocumented-key',
          'hint',
          spec.note
            ? `\`${name}\` is not in the Claude Code frontmatter reference. ${spec.note}`
            : `\`${name}\` is not in the Claude Code frontmatter reference and is ignored.`,
          keySpan(f),
          { href: ctx.spec.docsUrl },
        ),
      );
    }
    return out;
  },
};

/**
 * Portability lint, opt-in.
 *
 * Outside Claude Code — claude.ai uploads, the Skills API, package_skill.py —
 * only six keys are accepted and anything else is a hard error there. Most
 * skills are never distributed that way, so this is off unless asked for.
 */
export const portability: Rule = {
  id: 'portability',
  run(ctx) {
    if (!ctx.options.portability) return [];

    const out: Finding[] = [];
    const allowed = new Set(ctx.spec.portableFields);

    for (const [name, f] of ctx.fields) {
      if (allowed.has(name)) continue;
      out.push(
        finding(
          'portability',
          'hint',
          `\`${name}\` is rejected outside Claude Code (claude.ai uploads, the Skills API). Portable keys: ${ctx.spec.portableFields.join(', ')}.`,
          keySpan(f),
          { href: ctx.spec.docsUrl },
        ),
      );
    }

    // The spec validator is stricter than the Claude Code runtime about the
    // fields it does allow.
    const desc = ctx.fields.get('description');
    if (desc && typeof desc.value === 'string') {
      const c = SKILL_PORTABLE_CONSTRAINTS.description;
      if (desc.value.length > c.maxLength) {
        out.push(
          finding(
            'portability-length',
            'hint',
            `\`description\` is ${desc.value.length} characters; the Agent Skills spec caps it at ${c.maxLength}.`,
            valueSpan(desc),
            { href: ctx.spec.docsUrl },
          ),
        );
      }
      const bad = c.denyChars.filter((ch) => desc.value!.toString().includes(ch));
      if (bad.length) {
        out.push(
          finding(
            'portability-chars',
            'hint',
            `\`description\` contains ${bad.map((b) => `\`${b}\``).join(' and ')}, which the Agent Skills spec rejects.`,
            valueSpan(desc),
            { href: ctx.spec.docsUrl },
          ),
        );
      }
    }
    return out;
  },
};
