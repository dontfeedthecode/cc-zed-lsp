import { basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { ArtifactKind } from '@thecode/claude-skills-schema';

/**
 * Decides whether a document is a Claude Code artifact, and what kind.
 *
 * The extension attaches to every Markdown buffer — Zed has no finer hook that
 * doesn't cost markdown preview and the user's own `languages.Markdown`
 * settings. So this gate is what keeps us out of everyone's README, and every
 * feature must early-return on a null result.
 */

export type Scope = 'user' | 'project' | 'plugin' | 'synced' | 'unknown';

export interface ArtifactDescriptor {
  kind: ArtifactKind;
  /** Directory holding the artifact. */
  dir: string;
  /** Directory name — the command name, for skills. */
  dirName: string;
  scope: Scope;
  /** Nearest ancestor containing .claude-plugin/plugin.json. */
  pluginRoot?: string;
  /**
   * Synced skills are generated from a claude.ai account and rewritten on every
   * sync. Diagnostics on them are noise the user cannot act on.
   */
  readOnly: boolean;
}

export interface GateOptions {
  /** Extra globs, for unconventional layouts. Matched against the full path. */
  include?: string[];
  exclude?: string[];
  enabled?: boolean;
}

function toPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

const segments = (p: string): string[] => p.split(sep).filter(Boolean);

/** Walk up looking for a plugin manifest, which is always at .claude-plugin/plugin.json. */
function findPluginRoot(dir: string): string | undefined {
  let cur = dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(`${cur}${sep}.claude-plugin${sep}plugin.json`)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

function classifyScope(path: string, dir: string): { scope: Scope; pluginRoot?: string } {
  const segs = segments(path);

  // Synced skills live under .claude/skills/synced/<uuid>/<name>/SKILL.md.
  const skillsIdx = segs.lastIndexOf('skills');
  if (skillsIdx >= 0 && segs[skillsIdx + 1]?.toLowerCase() === 'synced') {
    return { scope: 'synced' };
  }

  const pluginRoot = findPluginRoot(dir);
  if (pluginRoot) return { scope: 'plugin', pluginRoot };

  const claudeIdx = segs.lastIndexOf('.claude');
  if (claudeIdx >= 0) {
    // ~/.claude/... is personal; <project>/.claude/... is project-scoped.
    const home = segments(process.env.HOME ?? '');
    const underHome =
      home.length > 0 &&
      claudeIdx === home.length &&
      segs.slice(0, home.length).join('/') === home.join('/');
    return { scope: underHome ? 'user' : 'project' };
  }
  return { scope: 'unknown' };
}

const GLOBSTAR = '__GLOBSTAR__';

/** Minimal glob support for the include/exclude escape hatches. */
function globToRegExp(glob: string): RegExp {
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, GLOBSTAR)
    .replace(/\*/g, '[^/]*')
    .split(GLOBSTAR)
    .join('(?:.*/)?')
    .replace(/\?/g, '.');
  return new RegExp(`^${src}$`);
}

/**
 * Classify a document URI.
 *
 * For skills the test is deliberately just `basename === 'SKILL.md'`. Requiring
 * a `skills/` ancestor would miss three real layouts: the anthropics/skills repo
 * (`<name>/SKILL.md` at the root), a plugin-root SKILL.md, and a skill being
 * drafted in a scratch directory. Directory shape refines `scope` instead of
 * gating, so a false positive costs a hint rather than a missed file.
 */
export function classify(uri: string, options: GateOptions = {}): ArtifactDescriptor | null {
  if (options.enabled === false) return null;

  // untitled:/ and other schemes have no layout to reason about, so they gate
  // off: a stray completion list in a scratch buffer is worse than none.
  const path = toPath(uri);
  if (!path) return null;

  const posix = path.split(sep).join('/');
  if (options.exclude?.some((g) => globToRegExp(g).test(posix))) return null;

  const base = basename(path);
  const dir = dirname(path);

  const forcedByInclude = options.include?.some((g) => globToRegExp(g).test(posix)) ?? false;
  if (base !== 'SKILL.md' && !forcedByInclude) return null;

  const { scope, pluginRoot } = classifyScope(path, dir);
  return {
    kind: 'skill',
    dir,
    dirName: basename(dir),
    scope,
    ...(pluginRoot ? { pluginRoot } : {}),
    readOnly: scope === 'synced',
  };
}

/**
 * A near-miss on a case-preserving filesystem. Worth a hint: the docs are
 * explicit that the filename is case-sensitive, so `Skill.md` is never
 * discovered as a skill at all.
 */
export function looksLikeMiscasedSkill(uri: string): boolean {
  const path = toPath(uri);
  if (!path) return false;
  const base = basename(path);
  return base !== 'SKILL.md' && base.toLowerCase() === 'skill.md';
}
