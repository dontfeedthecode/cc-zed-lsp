import type { ArtifactSpec, Finding, ValidationOptions } from './types.js';
import { parseFrontmatter } from './parse.js';

export interface ValidateInput {
  text: string;
  spec: ArtifactSpec;
  /** Folder containing the artifact, used for name/folder and reserved-name checks. */
  dirName?: string;
  options?: ValidationOptions;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2, hint: 3 } as const;

/**
 * Validate one artifact document.
 *
 * Structural findings (missing fence, bad YAML) are always produced. Rule
 * findings only run when the document parsed, because a rule reasoning about a
 * half-parsed field map produces noise exactly when the user is mid-edit.
 */
export function validate({ text, spec, dirName, options = {} }: ValidateInput): Finding[] {
  const parsed = parseFrontmatter(text);
  const findings = [...parsed.findings];

  if (parsed.split && parsed.ok) {
    const ctx = {
      spec,
      fields: parsed.fields,
      frontmatterStart: parsed.split.bodyStart,
      frontmatterEnd: parsed.split.bodyEnd,
      dirName,
      options: { reportUndocumented: true, ...options },
    };
    for (const rule of spec.rules) {
      try {
        findings.push(...rule.run(ctx));
      } catch (err) {
        // A broken rule must never take down validation for the whole file.
        findings.push({
          code: 'rule-crashed',
          severity: 'info',
          message: `Rule \`${rule.id}\` failed: ${(err as Error).message}`,
          start: ctx.frontmatterStart,
          end: ctx.frontmatterStart,
        });
      }
    }
  }

  return findings.sort(
    (a, b) => a.start - b.start || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
