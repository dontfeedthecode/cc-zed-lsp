import type { Finding, Rule, RuleContext } from '../types.js';
import { finding, keySpan, valueSpan, isBooleanLike, BOOLEAN_WORDS, nearestNames } from './helpers.js';

const href = (ctx: RuleContext) => ctx.spec.docsUrl;

/** Enum fields: reject values outside the curated set, and offer the nearest match. */
export const enumValues: Rule = {
  id: 'enum-value',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (!spec || spec.type !== 'enum' || !spec.enum) continue;
      if (f.value === undefined || f.value === null) continue;

      const raw = typeof f.value === 'string' ? f.value : String(f.value);
      if (spec.enum.includes(raw)) continue;

      const suggestions = nearestNames(raw, spec.enum);
      out.push(
        finding(
          'enum-value',
          'error',
          `\`${raw}\` is not a valid value for \`${name}\`. Accepted: ${spec.enum.map((v) => `\`${v}\``).join(', ')}.`,
          valueSpan(f),
          { href: href(ctx), data: { suggestions } },
        ),
      );
    }
    return out;
  },
};

/** Boolean fields: Claude Code accepts 8 spellings, but not arbitrary words. */
export const booleanValues: Rule = {
  id: 'boolean-value',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (!spec || spec.type !== 'boolean') continue;
      if (f.value === undefined || f.value === null) continue;
      if (isBooleanLike(f.raw, f.value)) continue;

      out.push(
        finding(
          'boolean-value',
          'error',
          `\`${name}\` expects a boolean. Accepted: ${BOOLEAN_WORDS.join(', ')} (any case).`,
          valueSpan(f),
          { href: href(ctx), data: { suggestions: ['true', 'false'] } },
        ),
      );
    }
    return out;
  },
};

/** Hard character limits, e.g. compatibility's documented 500. */
export const maxLengths: Rule = {
  id: 'max-length',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (!spec?.maxLength || typeof f.value !== 'string') continue;
      if (f.value.length <= spec.maxLength) continue;

      out.push(
        finding(
          'max-length',
          'error',
          `\`${name}\` is ${f.value.length} characters; the maximum is ${spec.maxLength}.`,
          valueSpan(f),
          { href: href(ctx) },
        ),
      );
    }
    return out;
  },
};

/** Shape constraints, e.g. name must be kebab-case. */
export const patterns: Rule = {
  id: 'pattern',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (!spec?.pattern || typeof f.value !== 'string' || !f.value) continue;
      if (spec.pattern.test(f.value)) continue;

      out.push(
        finding(
          'pattern',
          'warning',
          `\`${name}\` should be ${spec.patternHint ?? `of the form ${spec.pattern}`}.`,
          valueSpan(f),
          { href: href(ctx) },
        ),
      );
    }
    return out;
  },
};

/** `description` is how Claude decides when to use the skill; without it there is only a guess. */
export const missingDescription: Rule = {
  id: 'missing-description',
  run(ctx) {
    const d = ctx.fields.get('description');
    if (d && typeof d.value === 'string' && d.value.trim()) return [];
    if (!ctx.spec.fields.has('description')) return [];

    return [
      finding(
        'missing-description',
        'warning',
        'No `description`. Claude falls back to the first line of the body when deciding whether to use this skill, which is rarely what you want.',
        d
          ? keySpan(d)
          : { start: ctx.frontmatterStart, end: ctx.frontmatterStart },
        { href: ctx.spec.docsUrl },
      ),
    ];
  },
};
