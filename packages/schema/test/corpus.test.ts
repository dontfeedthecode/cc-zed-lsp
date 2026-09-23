import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { validate, SKILL_SPEC, type Finding } from '../src/index.js';

/**
 * The regression net: run the validator across every real SKILL.md installed on
 * this machine and assert it produces no Errors.
 *
 * These files are NOT vendored into the repo. Several shipped skills are marked
 * proprietary, and redistributing their content to get a test fixture is not a
 * trade worth making. So the corpus is read live and the suite skips when the
 * directory is absent (CI, or a fresh checkout). Committed synthetic fixtures in
 * rules.test.ts carry the per-rule assertions that must run everywhere.
 */
const CLAUDE_DIR = join(homedir(), '.claude');

/** Size of the corpus the hardcoded census tallies were taken against. */
const CENSUS_SIZE = 46;

function findSkills(root: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || !existsSync(root)) return out;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) findSkills(p, out, depth + 1);
    else if (name === 'SKILL.md') out.push(p);
  }
  return out;
}

const skills = existsSync(CLAUDE_DIR) ? findSkills(CLAUDE_DIR) : [];

describe.skipIf(skills.length === 0)('golden corpus: real SKILL.md files under ~/.claude', () => {
  const results = skills.map((path) => ({
    path,
    findings: validate({
      text: readFileSync(path, 'utf8'),
      spec: SKILL_SPEC,
      dirName: basename(dirname(path)),
    }),
  }));

  it('finds a non-trivial number of skills', () => {
    expect(results.length).toBeGreaterThan(10);
  });

  it('reports zero errors across every shipped skill', () => {
    const errors = results.flatMap(({ path, findings }) =>
      findings.filter((f) => f.severity === 'error').map((f) => `${path}: [${f.code}] ${f.message}`),
    );
    expect(errors).toEqual([]);
  });

  it('never crashes a rule', () => {
    const crashed = results.flatMap(({ path, findings }) =>
      findings.filter((f) => f.code === 'rule-crashed').map((f) => `${path}: ${f.message}`),
    );
    expect(crashed).toEqual([]);
  });

  it('rediscovers the authoring problems found during the manual census', () => {
    const byCode = new Map<string, number>();
    for (const { findings } of results) {
      for (const f of findings) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    }

    // The exact tallies below are a property of ONE corpus: the 46 files the
    // census was taken against. Every other contributor has a different
    // ~/.claude, so asserting them unconditionally would fail on their machine
    // for a reason that says nothing about this code. Pin them only when the
    // corpus is recognisably the censused one; otherwise fall back to the
    // invariant that actually generalises — the rules still fire.
    if (results.length === CENSUS_SIZE) {
      // The census found `version:` in 13 files (a key Claude Code does not
      // read) and `tools:` in 2 (subagent frontmatter in a skill). If the rule
      // engine works it finds both without being told where.
      expect(byCode.get('undocumented-key')).toBe(13);
      expect(byCode.get('misplaced-key')).toBe(2);
    } else {
      expect(byCode.get('undocumented-key') ?? 0).toBeGreaterThan(0);
    }

    // Deliberately asserted absent, and this one DOES generalise: a correctly
    // authored skill pairs `model:` with `context: fork`. If it ever becomes
    // non-zero, a skill has grown a model override that may not take effect.
    expect(byCode.get('model-without-fork') ?? 0).toBe(0);
  });
});
