import { describe, it, expect } from 'vitest';
import { validate, SKILL_SPEC, type Finding, type Severity } from '../src/index.js';

const fm = (body: string, content = '\nDo the thing.\n') => `---\n${body}\n---\n${content}`;

function run(text: string, opts: { dirName?: string; portability?: boolean } = {}): Finding[] {
  return validate({
    text,
    spec: SKILL_SPEC,
    dirName: opts.dirName ?? 'my-skill',
    options: opts.portability ? { portability: true } : {},
  });
}

const codes = (f: Finding[]) => f.map((x) => x.code);
const sev = (f: Finding[], code: string): Severity | undefined =>
  f.find((x) => x.code === code)?.severity;

const VALID = fm('name: my-skill\ndescription: Does a thing when you ask for a thing.');

describe('a well-formed skill', () => {
  it('produces no findings', () => {
    expect(run(VALID)).toEqual([]);
  });

  it('accepts every documented boolean spelling', () => {
    for (const v of ['true', 'FALSE', 'yes', 'No', 'on', 'OFF', '1', '0']) {
      const f = run(fm(`name: my-skill\ndescription: x\nuser-invocable: ${v}`));
      expect(codes(f), `spelling ${v}`).not.toContain('boolean-value');
    }
  });

  it('accepts all three allowed-tools syntaxes', () => {
    const variants = [
      'allowed-tools: Read, Grep',
      'allowed-tools: [Read, Grep]',
      'allowed-tools:\n  - Read\n  - Grep',
    ];
    for (const v of variants) {
      expect(codes(run(fm(`name: my-skill\ndescription: x\n${v}`))), v).toEqual([]);
    }
  });
});

describe('structural errors', () => {
  it('flags an opening fence that is not the first line', () => {
    const f = run('\n---\nname: my-skill\ndescription: x\n---\n');
    expect(codes(f)).toContain('fence-not-first-line');
    expect(sev(f, 'fence-not-first-line')).toBe('error');
  });

  it('flags frontmatter with no closing fence', () => {
    const f = run('---\nname: my-skill\ndescription: x\n');
    expect(codes(f)).toContain('unterminated-frontmatter');
  });

  it('flags unparseable YAML', () => {
    expect(codes(run(fm('name: [unclosed\ndescription: x')))).toContain('yaml-error');
  });

  it('flags a duplicate key', () => {
    expect(codes(run(fm('name: a\nname: b\ndescription: x')))).toContain('duplicate-key');
  });

  it('treats a file with no frontmatter at all as content, silently', () => {
    expect(run('# Just a document\n\nNothing to see.\n')).toEqual([]);
  });
});

describe('value validation', () => {
  it('rejects an out-of-set enum value and suggests the nearest', () => {
    const f = run(fm('name: my-skill\ndescription: x\neffort: extreme'));
    const hit = f.find((x) => x.code === 'enum-value')!;
    expect(hit.severity).toBe('error');
    expect(hit.message).toContain('xhigh');
  });

  it('suggests the nearest enum value for a near-miss', () => {
    const f = run(fm('name: my-skill\ndescription: x\neffort: hihg'));
    expect(f.find((x) => x.code === 'enum-value')?.data?.suggestions).toContain('high');
  });

  it('rejects a non-boolean in a boolean field', () => {
    expect(codes(run(fm('name: my-skill\ndescription: x\nuser-invocable: maybe')))).toContain(
      'boolean-value',
    );
  });

  it('rejects compatibility over its documented 500-char limit', () => {
    const f = run(fm(`name: my-skill\ndescription: x\ncompatibility: ${'a'.repeat(501)}`));
    expect(sev(f, 'max-length')).toBe('error');
  });

  it('warns when name is not kebab-case', () => {
    expect(sev(run(fm('name: My_Skill\ndescription: x')), 'pattern')).toBe('warning');
  });

  it('never rejects an unfamiliar model id', () => {
    const f = run(fm('name: my-skill\ndescription: x\ncontext: fork\nmodel: some-future-model'));
    expect(codes(f)).toEqual([]);
  });
});

describe('cross-field rules', () => {
  it('warns that agent is inert without context: fork', () => {
    const f = run(fm('name: my-skill\ndescription: x\nagent: Explore'));
    expect(sev(f, 'requires-sibling')).toBe('warning');
    expect(f.find((x) => x.code === 'requires-sibling')!.message).toContain('context: fork');
  });

  it('stays quiet when context: fork is present', () => {
    expect(codes(run(fm('name: my-skill\ndescription: x\ncontext: fork\nagent: Explore')))).toEqual(
      [],
    );
  });

  it('hints — not warns — about model without fork, because the sources disagree', () => {
    expect(sev(run(fm('name: my-skill\ndescription: x\nmodel: opus')), 'model-without-fork')).toBe(
      'hint',
    );
  });

  it('warns when description + when_to_use exceed the listing cap', () => {
    const f = run(
      fm(`name: my-skill\ndescription: ${'a'.repeat(800)}\nwhen_to_use: ${'b'.repeat(800)}`),
    );
    expect(sev(f, 'description-budget')).toBe('warning');
    expect(f.find((x) => x.code === 'description-budget')!.message).toContain('1536');
  });

  it('does not fire the budget rule when comfortably under', () => {
    expect(codes(run(fm('name: my-skill\ndescription: short\nwhen_to_use: also short')))).toEqual(
      [],
    );
  });

  it('errors on the reserved folder name', () => {
    expect(sev(run(VALID, { dirName: 'synced' }), 'reserved-folder')).toBe('error');
  });

  it('hints when name and folder disagree', () => {
    expect(sev(run(VALID, { dirName: 'other-folder' }), 'name-directory-mismatch')).toBe('hint');
  });
});

describe('key rules', () => {
  it('warns on an unknown key with a did-you-mean', () => {
    const f = run(fm('name: my-skill\ndescription: x\ndescriptoin: oops'));
    const hit = f.find((x) => x.code === 'unknown-key')!;
    expect(hit.severity).toBe('warning');
    expect(hit.data?.renameTo).toBe('description');
  });

  it('names the right field when subagent frontmatter lands in a skill', () => {
    const f = run(fm('name: my-skill\ndescription: x\ntools: Read, Grep'));
    const hit = f.find((x) => x.code === 'misplaced-key')!;
    expect(hit.severity).toBe('warning');
    expect(hit.data?.renameTo).toBe('allowed-tools');
  });

  it('only hints at real-but-undocumented keys', () => {
    // 13 of the 46 shipped skills use `version:`. Erroring here would train
    // users to ignore every other diagnostic.
    expect(sev(run(fm('name: my-skill\ndescription: x\nversion: 1.0.0')), 'undocumented-key')).toBe(
      'hint',
    );
  });

  it('warns when description is missing entirely', () => {
    expect(sev(run(fm('name: my-skill')), 'missing-description')).toBe('warning');
  });
});

describe('portability profile', () => {
  const PORTABLE = fm('name: my-skill\ndescription: x\neffort: high');

  it('is silent unless asked for', () => {
    expect(codes(run(PORTABLE))).toEqual([]);
  });

  it('flags keys rejected outside Claude Code', () => {
    const f = run(PORTABLE, { portability: true });
    expect(f.find((x) => x.code === 'portability')!.message).toContain('effort');
  });

  it('applies the stricter spec limits to description', () => {
    const f = run(fm(`name: my-skill\ndescription: ${'a'.repeat(1025)}`), { portability: true });
    expect(codes(f)).toContain('portability-length');
  });

  it('flags angle brackets the spec validator rejects', () => {
    const f = run(fm('name: my-skill\ndescription: Use for <html> files'), { portability: true });
    expect(codes(f)).toContain('portability-chars');
  });
});
