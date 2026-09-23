/**
 * Values accepted by a skill's `model:` field.
 *
 * The docs say only "accepts the same values as /model, or `inherit`", which is
 * an open set — new model IDs ship without a docs table change. So this list
 * drives *completion suggestions only*. Validation never rejects a `model:`
 * value; an unrecognised one is silently accepted.
 */
export interface ModelSuggestion {
  value: string;
  detail: string;
  /** Lower sorts first in the completion list. */
  tier: number;
}

export const MODEL_SUGGESTIONS: readonly ModelSuggestion[] = [
  { value: 'inherit', detail: 'Use the session model', tier: 0 },

  // Aliases track the current generation and are the safer choice in a skill
  // that will outlive a model release.
  { value: 'opus', detail: 'Alias — most capable', tier: 1 },
  { value: 'sonnet', detail: 'Alias — balanced', tier: 1 },
  { value: 'haiku', detail: 'Alias — fastest', tier: 1 },
  { value: 'fable', detail: 'Alias', tier: 1 },

  // Pinned IDs, for a skill that must not drift across model releases.
  { value: 'claude-opus-5', detail: 'Opus 5', tier: 2 },
  { value: 'claude-sonnet-5', detail: 'Sonnet 5', tier: 2 },
  { value: 'claude-fable-5-1', detail: 'Fable 5.1', tier: 2 },
  { value: 'claude-haiku-4-5-20251001', detail: 'Haiku 4.5', tier: 2 },
] as const;

/** Built-in subagent types, always available regardless of the workspace. */
export const BUILTIN_AGENTS: readonly ModelSuggestion[] = [
  { value: 'Explore', detail: 'Built-in — read-only codebase search', tier: 0 },
  { value: 'Plan', detail: 'Built-in — designs an implementation plan', tier: 0 },
  { value: 'general-purpose', detail: 'Built-in — multi-step tasks', tier: 0 },
] as const;

/**
 * Parameterised `allowed-tools` forms observed in shipped first-party skills.
 * Offered as snippet completions alongside the plain tool names.
 */
export const TOOL_PATTERN_TEMPLATES: readonly { label: string; snippet: string; detail: string }[] = [
  { label: 'Bash(...)', snippet: 'Bash(${1:git status}:*)', detail: 'Pre-approve a command prefix' },
  { label: 'Agent(...)', snippet: 'Agent(${1:agent-name})', detail: 'Pre-approve a subagent' },
  { label: 'Workflow(...)', snippet: 'Workflow(${1:name})', detail: 'Pre-approve a workflow' },
  { label: 'mcp__...', snippet: 'mcp__${1:server}__${2:tool}', detail: 'Pre-approve an MCP tool' },
] as const;
