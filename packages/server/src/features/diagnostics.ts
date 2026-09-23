import {
  DiagnosticSeverity,
  type Diagnostic,
} from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { validate, type Finding, type Severity } from '@thecode/claude-skills-schema';
import type { ArtifactDescriptor } from '../gate.js';
import { specFor } from '@thecode/claude-skills-schema';
import type { ServerConfig } from '../config.js';

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

export const DIAGNOSTIC_SOURCE = 'claude-skills';

function toDiagnostic(doc: TextDocument, f: Finding): Diagnostic {
  return {
    range: { start: doc.positionAt(f.start), end: doc.positionAt(f.end) },
    severity: SEVERITY[f.severity],
    code: f.code,
    ...(f.href ? { codeDescription: { href: f.href } } : {}),
    source: DIAGNOSTIC_SOURCE,
    message: f.message,
    ...(f.data ? { data: f.data } : {}),
  };
}

export function computeDiagnostics(
  doc: TextDocument,
  artifact: ArtifactDescriptor,
  config: ServerConfig,
): Diagnostic[] {
  // Synced skills are regenerated from a claude.ai account on every sync, so
  // anything we flag is both un-actionable and guaranteed to come back.
  if (artifact.readOnly) return [];

  const spec = specFor(artifact.kind);
  if (!spec) return [];

  const findings = validate({
    text: doc.getText(),
    spec,
    dirName: artifact.dirName,
    options: {
      portability: config.portability,
      reportUndocumented: config.reportUndocumented,
    },
  });

  return findings.map((f) => toDiagnostic(doc, f));
}
