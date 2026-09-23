import type { Finding, Rule } from '../types.js';
import { finding, keySpan } from './helpers.js';

/**
 * Fields that only take effect alongside a sibling, e.g. `agent` and
 * `background` require `context: fork`.
 *
 * Warning, never Error: the file still loads and the skill still runs. The
 * field is simply inert, which is precisely the kind of silent no-op that is
 * invisible without tooling.
 */
export const requiresSibling: Rule = {
  id: 'requires-sibling',
  run(ctx) {
    const out: Finding[] = [];
    for (const [name, f] of ctx.fields) {
      const spec = ctx.spec.fields.get(name);
      if (!spec?.requires) continue;

      for (const [sibling, expected] of Object.entries(spec.requires)) {
        const actual = ctx.fields.get(sibling)?.value;
        if (actual === expected) continue;

        out.push(
          finding(
            'requires-sibling',
            'warning',
            actual === undefined
              ? `\`${name}\` has no effect without \`${sibling}: ${expected}\`.`
              : `\`${name}\` has no effect unless \`${sibling}\` is \`${expected}\` (it is \`${String(actual)}\`).`,
            keySpan(f),
            { href: ctx.spec.docsUrl },
          ),
        );
      }
    }
    return out;
  },
};

/**
 * `model:` without `context: fork`.
 *
 * Reported as a Hint, deliberately, because the sources disagree. The docs say
 * the override "applies for the rest of the current turn", implying fork is not
 * required. Observed behaviour reported elsewhere says a skill's frontmatter
 * model only takes effect under `context: fork`. Until that is settled we
 * surface the ambiguity rather than asserting either way — a Warning here would
 * be telling users something we cannot actually stand behind.
 */
export const modelWithoutFork: Rule = {
  id: 'model-without-fork',
  run(ctx) {
    const model = ctx.fields.get('model');
    if (!model || model.value === undefined) return [];
    if (ctx.fields.get('context')?.value === 'fork') return [];

    return [
      finding(
        'model-without-fork',
        'hint',
        'Without `context: fork`, a skill-level `model:` may not take effect. The docs say the override applies for the rest of the turn; observed behaviour suggests it requires a forked context. Add `context: fork` if the model override matters.',
        keySpan(model),
        { href: ctx.spec.docsUrl },
      ),
    ];
  },
};

/**
 * `description` + `when_to_use` share a character budget in the skill listing.
 * Over it, the tail is truncated and Claude never sees it.
 *
 * Warning, not Error: the cap is configurable via `skillListingMaxDescChars`,
 * so a long description is a choice a user can legitimately have made.
 */
export const combinedBudget: Rule = {
  id: 'description-budget',
  run(ctx) {
    const seen = new Set<string>();
    const out: Finding[] = [];

    for (const [name, spec] of ctx.spec.fields) {
      const cap = spec.combinedCap;
      if (!cap || seen.has(name)) continue;
      seen.add(name);
      seen.add(cap.with);

      const a = ctx.fields.get(name);
      const b = ctx.fields.get(cap.with);
      const lenA = typeof a?.value === 'string' ? a.value.length : 0;
      const lenB = typeof b?.value === 'string' ? b.value.length : 0;
      const total = lenA + lenB;
      if (total <= cap.max) continue;

      const anchor = a ?? b;
      if (!anchor) continue;

      out.push(
        finding(
          'description-budget',
          'warning',
          `\`${name}\` + \`${cap.with}\` total ${total} characters, over the ${cap.max}-character skill-listing cap` +
            (cap.configurableVia ? ` (configurable via \`${cap.configurableVia}\`)` : '') +
            '. The tail is truncated, so put the key use case first.',
          keySpan(anchor),
          { href: ctx.spec.docsUrl },
        ),
      );
    }
    return out;
  },
};

/** The skill folder name `synced` is reserved for claude.ai-synced skills. */
export const reservedFolderName: Rule = {
  id: 'reserved-folder',
  run(ctx) {
    if (ctx.dirName?.toLowerCase() !== 'synced') return [];
    return [
      finding(
        'reserved-folder',
        'error',
        '`synced` is reserved for skills synced from your claude.ai account. Rename this folder.',
        { start: ctx.frontmatterStart, end: ctx.frontmatterStart },
        { href: ctx.spec.docsUrl },
      ),
    ];
  },
};

/**
 * `name` sets the display label but not the command — that comes from the
 * directory. A mismatch is legal and sometimes intentional, so: Hint.
 */
export const nameMatchesDirectory: Rule = {
  id: 'name-directory-mismatch',
  run(ctx) {
    const f = ctx.fields.get('name');
    if (!f || typeof f.value !== 'string' || !ctx.dirName) return [];
    if (f.value === ctx.dirName) return [];

    return [
      finding(
        'name-directory-mismatch',
        'hint',
        `\`name\` is \`${f.value}\` but the folder is \`${ctx.dirName}\`. For personal and project skills the command comes from the folder, so this sets the display label only.`,
        keySpan(f),
        { href: ctx.spec.docsUrl },
      ),
    ];
  },
};
