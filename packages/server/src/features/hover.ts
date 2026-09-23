import { MarkupKind, type Hover } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { parseFrontmatter, specFor, type FieldSpec } from '@thecode/claude-skills-schema';
import type { ArtifactDescriptor } from '../gate.js';

/**
 * Hover uses Tier A (the real YAML parse) and returns nothing when the document
 * does not parse. That is the right trade here: a null hover on a half-typed
 * document is invisible, whereas a wrong hover is actively misleading.
 */
function render(field: FieldSpec): string {
  const head = [
    `**\`${field.name}\`**`,
    field.required === 'Recommended' || field.required === 'Yes'
      ? field.required.toLowerCase()
      : 'optional',
    field.type !== 'unknown' ? field.type : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const parts = [head];
  if (field.documentation) parts.push(field.documentation);

  const constraints: string[] = [];
  if (field.enum?.length) {
    constraints.push(`**Values:** ${field.enum.map((v) => `\`${v}\``).join(' · ')}`);
  }
  if (field.default !== undefined) constraints.push(`**Default:** \`${field.default}\``);
  if (field.maxLength) constraints.push(`**Max length:** ${field.maxLength} characters`);
  if (field.combinedCap) {
    constraints.push(
      `**Budget:** shares a ${field.combinedCap.max}-character cap with \`${field.combinedCap.with}\``,
    );
  }
  if (field.requires) {
    for (const [k, v] of Object.entries(field.requires)) {
      constraints.push(`**Requires:** \`${k}: ${v}\``);
    }
  }
  if (field.note) constraints.push(`_${field.note}_`);
  if (constraints.length) parts.push(constraints.join('  \n'));

  if (field.docsUrl) parts.push(`[Docs](${field.docsUrl})`);
  return parts.join('\n\n');
}

export function computeHover(
  doc: TextDocument,
  offset: number,
  artifact: ArtifactDescriptor,
): Hover | null {
  const spec = specFor(artifact.kind);
  if (!spec) return null;

  const parsed = parseFrontmatter(doc.getText());
  if (!parsed.split) return null;

  for (const field of parsed.fields.values()) {
    if (offset < field.keyStart || offset > field.keyEnd) continue;

    const known = spec.fields.get(field.key);
    if (!known) return null;

    return {
      contents: { kind: MarkupKind.Markdown, value: render(known) },
      range: { start: doc.positionAt(field.keyStart), end: doc.positionAt(field.keyEnd) },
    };
  }
  return null;
}
