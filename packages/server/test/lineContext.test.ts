import { describe, it, expect } from 'vitest';
import { cursorContext, frontmatterBounds } from '../src/frontmatter/lineContext.js';

/**
 * Fixtures mark the caret with ‸. Every case below is a document the user is in
 * the middle of typing, which is the whole point: most of these do not parse as
 * YAML, and Tier B must still answer correctly.
 */
function at(fixture: string) {
  const offset = fixture.indexOf('‸');
  if (offset < 0) throw new Error('fixture needs a ‸ caret marker');
  return cursorContext(fixture.replace('‸', ''), offset);
}

describe('frontmatterBounds', () => {
  it('requires the opening fence on line 1', () => {
    expect(frontmatterBounds('\n---\nname: x\n---\n')).toBeNull();
    expect(frontmatterBounds('# Title\n---\nname: x\n---\n')).toBeNull();
  });

  it('reports an unterminated block while it is still being typed', () => {
    expect(frontmatterBounds('---\nname: x\n')).toMatchObject({ unterminated: true });
    expect(frontmatterBounds('---\nname: x\n---\n')).toMatchObject({ unterminated: false });
  });
});

describe('key position', () => {
  it('resolves an empty line inside frontmatter', () => {
    const c = at('---\nname: x\n‸\n---\n');
    expect(c.kind).toBe('fmKey');
    expect(c).toMatchObject({ prefix: '', siblings: ['name'] });
  });

  it('resolves a partially typed key', () => {
    expect(at('---\ndesc‸\n---\n')).toMatchObject({ kind: 'fmKey', prefix: 'desc' });
  });

  it('reports existing siblings so completion can filter them out', () => {
    const c = at('---\nname: a\ndescription: b\ne‸\n---\n');
    expect(c).toMatchObject({ kind: 'fmKey' });
    expect((c as any).siblings).toEqual(['name', 'description']);
  });

  it('treats an indented key as nested and resolves its path', () => {
    const c = at('---\nhooks:\n  Pre‸\n---\n');
    expect(c).toMatchObject({ kind: 'fmNestedKey', prefix: 'Pre', path: ['hooks'] });
  });
});

describe('value position', () => {
  it('resolves immediately after the colon, with nothing typed', () => {
    expect(at('---\neffort: ‸\n---\n')).toMatchObject({
      kind: 'fmValue',
      key: 'effort',
      prefix: '',
      style: 'plain',
    });
  });

  it('resolves with no space after the colon', () => {
    expect(at('---\neffort:‸\n---\n')).toMatchObject({ kind: 'fmValue', key: 'effort' });
  });

  it('resolves a partially typed value', () => {
    expect(at('---\neffort: hi‸\n---\n')).toMatchObject({ key: 'effort', prefix: 'hi' });
  });

  it('replaces only the last segment of a comma-separated scalar list', () => {
    const c = at('---\nallowed-tools: Read, Gr‸\n---\n') as any;
    expect(c).toMatchObject({ kind: 'fmValue', key: 'allowed-tools', prefix: 'Gr' });
    // Accepting a completion must not eat `Read, `.
    expect(c.replaceEnd - c.replaceStart).toBe(2);
  });

  it('replaces only the last segment inside an unclosed flow list', () => {
    const c = at('---\nallowed-tools: [Read, Gr‸\n---\n') as any;
    expect(c).toMatchObject({ kind: 'fmValue', style: 'flow', prefix: 'Gr' });
    expect(c.replaceEnd - c.replaceStart).toBe(2);
  });

  it('handles a hyphenated key', () => {
    expect(at('---\nuser-invocable: tr‸\n---\n')).toMatchObject({ key: 'user-invocable' });
  });
});

describe('sequence items', () => {
  it('resolves a block list item to its owning key', () => {
    expect(at('---\nallowed-tools:\n  - Re‸\n---\n')).toMatchObject({
      kind: 'fmSeqItem',
      key: 'allowed-tools',
      prefix: 'Re',
    });
  });

  it('resolves an empty list item', () => {
    expect(at('---\nallowed-tools:\n  - ‸\n---\n')).toMatchObject({
      kind: 'fmSeqItem',
      key: 'allowed-tools',
      prefix: '',
    });
  });
});

describe('outside the frontmatter', () => {
  it('returns outside in the body', () => {
    expect(at('---\nname: x\n---\nSome ‸content\n').kind).toBe('outside');
  });

  it('returns outside when there is no frontmatter at all', () => {
    expect(at('# README\n\nHello ‸there\n').kind).toBe('outside');
  });

  it('recognises a substitution being typed in the body', () => {
    expect(at('---\nname: x\n---\nRun $ARG‸\n')).toMatchObject({
      kind: 'bodySubst',
      prefix: '$ARG',
    });
  });

  it('recognises a braced substitution', () => {
    expect(at('---\nname: x\n---\nSee ${CLAUDE_‸\n')).toMatchObject({ kind: 'bodySubst' });
  });
});

describe('degenerate input', () => {
  it('survives a tab-indented nested key', () => {
    expect(at('---\nhooks:\n\tPre‸\n---\n').kind).toBe('fmNestedKey');
  });

  it('works when the closing fence has not been typed yet', () => {
    expect(at('---\neffort: ‸').kind).toBe('fmValue');
  });

  it('does not classify inside the opening fence itself', () => {
    expect(at('-‸--\nname: x\n---\n').kind).toBe('outside');
  });
});
