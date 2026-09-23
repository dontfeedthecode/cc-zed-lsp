/** Server configuration, supplied via LSP initializationOptions or settings. */
export interface ServerConfig {
  /** Flag keys that are rejected outside Claude Code. Off by default. */
  portability: boolean;
  /** Hint at real-but-undocumented keys such as `version`. On by default. */
  reportUndocumented: boolean;
  /** Extra globs for unconventional layouts. */
  include: string[];
  exclude: string[];
  enabled: boolean;
  /** Debounce before publishing diagnostics. Set to 0 in tests. */
  debounceMs: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  portability: false,
  reportUndocumented: true,
  include: [],
  exclude: [],
  enabled: true,
  debounceMs: 250,
};

const asBool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Read config out of whatever the client sent.
 *
 * Zed nests extension settings under the language-server id, and different
 * clients disagree about whether config arrives in initializationOptions or
 * workspace/configuration, so both shapes are accepted and unknown keys are
 * ignored rather than rejected.
 */
export function readConfig(raw: unknown): ServerConfig {
  const root = (raw ?? {}) as Record<string, unknown>;
  const scoped = (root.claudeSkills ?? root['claude-skills'] ?? root) as Record<string, unknown>;

  return {
    portability: asBool(scoped.portability, DEFAULT_CONFIG.portability),
    reportUndocumented: asBool(scoped.reportUndocumented, DEFAULT_CONFIG.reportUndocumented),
    include: asStrings(scoped.include),
    exclude: asStrings(scoped.exclude),
    enabled: asBool(scoped.enabled, DEFAULT_CONFIG.enabled),
    debounceMs:
      typeof scoped.debounceMs === 'number' ? scoped.debounceMs : DEFAULT_CONFIG.debounceMs,
  };
}
