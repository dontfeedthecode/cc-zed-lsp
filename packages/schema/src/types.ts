/**
 * The vocabulary every other package speaks.
 *
 * INVARIANT: the feature layer (completion / hover / diagnostics) must reason only
 * about `FieldSpec` and `Rule`. There must be no `if (field.name === 'effort')`
 * anywhere outside `src/curated/`. That invariant is what makes adding a new
 * artifact type (agent, command, hook) a data change rather than a code change.
 */

/** Which authored artifact a document is. */
export type ArtifactKind = 'skill' | 'agent' | 'command' | 'output-style';

/** How a frontmatter value is shaped. */
export type ValueType =
  | 'string'
  | 'boolean'
  | 'enum'
  | 'string-or-list'
  | 'map'
  | 'unknown';

/**
 * Where a field's accepted values come from at completion time.
 * Static enums live on the FieldSpec; anything needing the docs extract or a
 * workspace scan is named here and resolved by a provider.
 */
export type DynamicEnum = 'models' | 'tools' | 'agents' | 'hook-events';

/** How confident we are that a key is real, which drives diagnostic severity. */
export type FieldProvenance =
  /** Present in the upstream docs frontmatter table. */
  | 'documented'
  /** Absent from the docs but observed in shipped first-party skills. Never an error. */
  | 'undocumented'
  /** Neither. Warned about, with a did-you-mean. */
  | 'unknown';

/** The hand-curated half of a field: everything the docs express only as prose. */
export interface Curation {
  type: ValueType;
  /** Static accepted values. Mutually exclusive with `dynamicEnum` in practice. */
  enum?: readonly string[];
  /** Named value provider, for value spaces too large or too dynamic to inline. */
  dynamicEnum?: DynamicEnum;
  /** Documented default, shown in hover. */
  default?: string | boolean;
  /** Hard character limit. Exceeding it is an Error. */
  maxLength?: number;
  /** Regex the value must match. */
  pattern?: RegExp;
  /** Human description of `pattern`, used in the diagnostic message. */
  patternHint?: string;
  /**
   * Cross-field precondition: this field only takes effect when the named
   * sibling holds the given value. Violations are Warnings, never Errors —
   * the file still loads, the field is just inert.
   */
  requires?: Record<string, string>;
  /** Soft cap shared across several fields (e.g. description + when_to_use). */
  combinedCap?: { with: string; max: number; configurableVia?: string };
  /** Separator for `string-or-list` fields given as a scalar. */
  listSeparator?: RegExp;
  /** Skip validation of this field's interior for now. */
  deferValidation?: string;
  /** Free-form maps accept any interior shape. */
  freeForm?: boolean;
  /** Why an undocumented field is tolerated; surfaced in the Hint. */
  note?: string;
  /** Sort tier for completion. Lower sorts first. */
  tier?: number;
}

/** A field after the generated docs extract and the curated layer are merged. */
export interface FieldSpec extends Curation {
  name: string;
  provenance: FieldProvenance;
  /** "No" | "Recommended" | "Yes", straight from the docs table. */
  required?: string;
  /** Docs prose, links already absolutised. Rendered verbatim in hover. */
  documentation?: string;
  /** Deep link to the field's docs section. */
  docsUrl?: string;
  /** Every backticked token in the docs description. Drift-probe substrate, NOT an enum. */
  codeTokens?: readonly string[];
}

/** A complete artifact schema. One of these per `ArtifactKind`. */
export interface ArtifactSpec {
  kind: ArtifactKind;
  docsUrl: string;
  fields: Map<string, FieldSpec>;
  /**
   * Keys accepted by targets outside Claude Code (claude.ai uploads, the Skills
   * API, package_skill.py). Anything else is a hard error there, so we surface
   * it as an opt-in Hint.
   */
  portableFields: readonly string[];
  rules: readonly Rule[];
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info' | 'hint';

/**
 * A validation result, in document byte offsets. Deliberately not an LSP
 * Diagnostic: this package stays free of LSP types so it can also back a CLI
 * linter and a GitHub Action. The server adapts offsets to Ranges.
 */
export interface Finding {
  /** Stable identifier, used for the docs deep link and for quick-fix routing. */
  code: string;
  severity: Severity;
  message: string;
  /** Document offsets, not frontmatter-relative. */
  start: number;
  end: number;
  /** Deep link shown as `codeDescription.href`. */
  href?: string;
  /** Quick-fix payload, e.g. candidate spellings for a misspelled key. */
  data?: { suggestions?: string[]; renameTo?: string };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** One parsed frontmatter entry with its source span. */
export interface ParsedField {
  key: string;
  /** Offsets of the key token itself. */
  keyStart: number;
  keyEnd: number;
  /** Offsets of the value, absent for `key:` with nothing after it. */
  valueStart?: number;
  valueEnd?: number;
  /** Scalar text as written, before YAML coercion. Absent for maps and lists. */
  raw?: string;
  /** YAML-parsed value. */
  value: unknown;
}

/** Everything a rule is allowed to see. */
export interface RuleContext {
  spec: ArtifactSpec;
  fields: Map<string, ParsedField>;
  /** Offsets of the whole frontmatter block, for document-level findings. */
  frontmatterStart: number;
  frontmatterEnd: number;
  /** Directory name containing the artifact, e.g. the skill folder. */
  dirName?: string;
  /** Opt-in checks. */
  options: ValidationOptions;
}

export interface ValidationOptions {
  /** Also flag keys rejected outside Claude Code. Off by default. */
  portability?: boolean;
  /** Surface Hints for undocumented-but-real keys. On by default. */
  reportUndocumented?: boolean;
}

export interface Rule {
  id: string;
  run(ctx: RuleContext): Finding[];
}

export const DOCS_ORIGIN = 'https://code.claude.com';
