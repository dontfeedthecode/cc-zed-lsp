import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  type CompletionItem,
} from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  specFor,
  BUILTIN_TOOLS,
  MODEL_SUGGESTIONS,
  BUILTIN_AGENTS,
  TOOL_PATTERN_TEMPLATES,
  parseFrontmatter,
  listItems,
  type ArtifactSpec,
  type FieldSpec,
} from '@thecode/claude-skills-schema';
import { cursorContext, type CursorContext } from '../frontmatter/lineContext.js';
import type { ArtifactDescriptor } from '../gate.js';

/**
 * Substitutions available in a skill body, beyond the per-argument ones.
 * `bodyOnly` marks argument substitutions, which mean nothing in frontmatter.
 */
const SUBSTITUTIONS: { label: string; detail: string; pluginOnly?: boolean; bodyOnly?: boolean }[] = [
  { label: '$ARGUMENTS', detail: 'All arguments passed to the skill', bodyOnly: true },
  { label: '${CLAUDE_SKILL_DIR}', detail: "The skill's own directory" },
  { label: '${CLAUDE_PROJECT_DIR}', detail: 'Project root' },
  { label: '${CLAUDE_SESSION_ID}', detail: 'Current session id' },
  { label: '${CLAUDE_EFFORT}', detail: 'Current effort level' },
  { label: '${CLAUDE_PLUGIN_ROOT}', detail: 'Plugin install directory', pluginOnly: true },
  { label: '${CLAUDE_PLUGIN_DATA}', detail: 'Plugin persistent data directory', pluginOnly: true },
];

function edit(ctx: Extract<CursorContext, { replaceStart: number }>, doc: TextDocument, newText: string) {
  return {
    range: { start: doc.positionAt(ctx.replaceStart), end: doc.positionAt(ctx.replaceEnd) },
    newText,
  };
}

/**
 * Insert text for a key.
 *
 * Enum fields get a choice placeholder, so accepting `effort` immediately offers
 * its five values without a second round trip. That single behaviour is most of
 * the perceived quality of the whole extension, which is why the snippet
 * capability is checked rather than assumed.
 */
function keyInsertText(field: FieldSpec, snippets: boolean): string {
  if (!snippets) return `${field.name}: `;

  if (field.type === 'enum' && field.enum?.length) {
    return field.enum.length === 1
      ? `${field.name}: ${field.enum[0]}`
      : `${field.name}: \${1|${field.enum.join(',')}|}`;
  }
  if (field.type === 'boolean') return `${field.name}: \${1|true,false|}`;
  if (field.type === 'map') return `${field.name}:\n  $1`;
  return `${field.name}: $1`;
}

function describeType(f: FieldSpec): string {
  if (f.type === 'enum' && f.enum) return f.enum.join(' | ');
  if (f.type === 'string-or-list') return 'string or list';
  if (f.type === 'unknown') return '';
  return f.type;
}

function documentation(f: FieldSpec) {
  const parts: string[] = [];
  if (f.documentation) parts.push(f.documentation);

  const constraints: string[] = [];
  if (f.enum?.length) constraints.push(`**Values:** ${f.enum.map((v) => `\`${v}\``).join(' · ')}`);
  if (f.default !== undefined) constraints.push(`**Default:** \`${f.default}\``);
  if (f.maxLength) constraints.push(`**Max length:** ${f.maxLength}`);
  if (f.requires) {
    for (const [k, v] of Object.entries(f.requires)) {
      constraints.push(`**Requires:** \`${k}: ${v}\``);
    }
  }
  if (f.note) constraints.push(`_${f.note}_`);
  if (constraints.length) parts.push(constraints.join('  \n'));
  if (f.docsUrl) parts.push(`[Docs](${f.docsUrl})`);

  return { kind: MarkupKind.Markdown, value: parts.join('\n\n') };
}

function keyCompletions(
  ctx: Extract<CursorContext, { kind: 'fmKey' }>,
  spec: ArtifactSpec,
  doc: TextDocument,
  snippets: boolean,
): CompletionItem[] {
  const present = new Set(ctx.siblings);
  const items: CompletionItem[] = [];

  for (const field of spec.fields.values()) {
    // Offering a key the document already has just produces a duplicate-key error.
    if (present.has(field.name)) continue;
    // Keys we tolerate but never recommend.
    if (field.provenance === 'undocumented') continue;

    const required = field.required === 'Recommended' || field.required === 'Yes';
    items.push({
      label: field.name,
      kind: CompletionItemKind.Field,
      detail: [describeType(field), required ? field.required!.toLowerCase() : 'optional']
        .filter(Boolean)
        .join(' · '),
      documentation: documentation(field),
      sortText: `${String(field.tier ?? 5).padStart(2, '0')}_${field.name}`,
      insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
      textEdit: edit(ctx, doc, keyInsertText(field, snippets)),
    });
  }
  return items;
}

function toolCompletions(
  ctx: Extract<CursorContext, { replaceStart: number }>,
  doc: TextDocument,
  snippets: boolean,
): CompletionItem[] {
  const items: CompletionItem[] = BUILTIN_TOOLS.map((t) => ({
    label: t.name,
    kind: CompletionItemKind.Function,
    detail: 'built-in tool',
    documentation: { kind: MarkupKind.Markdown, value: t.descriptionMarkdown },
    sortText: `1_${t.name}`,
    textEdit: edit(ctx, doc, t.name),
  }));

  // The parameterised forms are how real skills scope Bash and Agent access;
  // without them the list looks complete but omits the useful half.
  if (snippets) {
    for (const p of TOOL_PATTERN_TEMPLATES) {
      items.push({
        label: p.label,
        kind: CompletionItemKind.Snippet,
        detail: p.detail,
        sortText: `2_${p.label}`,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: edit(ctx, doc, p.snippet),
      });
    }
  }
  return items;
}

function valueCompletions(
  ctx: Extract<CursorContext, { kind: 'fmValue' } | { kind: 'fmSeqItem' }>,
  spec: ArtifactSpec,
  doc: TextDocument,
  snippets: boolean,
): CompletionItem[] {
  const field = spec.fields.get(ctx.key);
  if (!field) return [];

  if (field.type === 'enum' && field.enum) {
    return field.enum.map((v, i) => ({
      label: v,
      kind: CompletionItemKind.EnumMember,
      detail: field.default === v ? 'default' : undefined,
      sortText: `${i}`,
      textEdit: edit(ctx, doc, v),
    }));
  }

  if (field.type === 'boolean') {
    // true/false first: the other six spellings are accepted but idiosyncratic.
    return ['true', 'false', 'yes', 'no', 'on', 'off'].map((v, i) => ({
      label: v,
      kind: CompletionItemKind.Value,
      sortText: `${i}`,
      textEdit: edit(ctx, doc, v),
    }));
  }

  switch (field.dynamicEnum) {
    case 'tools':
      return toolCompletions(ctx, doc, snippets);
    case 'models':
      return MODEL_SUGGESTIONS.map((m) => ({
        label: m.value,
        kind: CompletionItemKind.Value,
        detail: m.detail,
        sortText: `${m.tier}_${m.value}`,
        textEdit: edit(ctx, doc, m.value),
      }));
    case 'agents':
      return BUILTIN_AGENTS.map((a) => ({
        label: a.value,
        kind: CompletionItemKind.Class,
        detail: a.detail,
        sortText: `${a.tier}_${a.value}`,
        textEdit: edit(ctx, doc, a.value),
      }));
    default:
      return [];
  }
}

/**
 * Positional and named argument substitutions, driven by the `arguments:` key.
 *
 * Each position is offered as `$N` immediately followed by its `$name`, so a
 * skill declaring `arguments: url` sees `$0` then `$url` at the top of the list.
 * With no declaration, `$0` is still offered: positional access always works.
 */
function argumentCompletions(
  ctx: Extract<CursorContext, { kind: 'bodySubst' }>,
  doc: TextDocument,
  spec: ArtifactSpec,
): CompletionItem[] {
  const field = parseFrontmatter(doc.getText()).fields.get('arguments');
  const sep = spec.fields.get('arguments')?.listSeparator ?? /[\s,]+/;
  const names = field ? listItems(field, sep) : [];

  const items: CompletionItem[] = [];
  const count = Math.max(names.length, 1);
  for (let i = 0; i < count; i++) {
    const pos = String(i).padStart(3, '0');
    items.push({
      label: `$${i}`,
      kind: CompletionItemKind.Variable,
      detail: names[i] ? `Argument ${i} (${names[i]})` : `Argument ${i} (0-based $ARGUMENTS[${i}])`,
      sortText: `0_${pos}_0`,
      textEdit: edit(ctx, doc, `$${i}`),
    });
    if (names[i]) {
      items.push({
        label: `$${names[i]}`,
        kind: CompletionItemKind.Variable,
        detail: `Named argument ${i} (from arguments:)`,
        sortText: `0_${pos}_1`,
        textEdit: edit(ctx, doc, `$${names[i]}`),
      });
    }
  }
  return items;
}

function substitutionCompletions(
  ctx: Extract<CursorContext, { kind: 'bodySubst' } | { kind: 'fmSubst' }>,
  doc: TextDocument,
  artifact: ArtifactDescriptor,
): CompletionItem[] {
  return SUBSTITUTIONS.filter(
    (s) => (!s.pluginOnly || artifact.scope === 'plugin') && (!s.bodyOnly || ctx.kind === 'bodySubst'),
  ).map((s, i) => ({
    label: s.label,
    kind: CompletionItemKind.Variable,
    detail: s.detail,
    sortText: `1_${String(i).padStart(2, '0')}`,
    textEdit: edit(ctx, doc, s.label),
  }));
}

export function computeCompletions(
  doc: TextDocument,
  offset: number,
  artifact: ArtifactDescriptor,
  snippets: boolean,
): CompletionItem[] {
  const spec = specFor(artifact.kind);
  if (!spec) return [];

  const ctx = cursorContext(doc.getText(), offset);

  switch (ctx.kind) {
    case 'fmKey':
      return keyCompletions(ctx, spec, doc, snippets);

    case 'fmValue':
    case 'fmSeqItem':
      return valueCompletions(ctx, spec, doc, snippets);

    case 'fmNestedKey':
      // Deep `hooks:` validation is out of scope, but offering the event names
      // is the part that actually saves a trip to the docs.
      if (ctx.path[0] === 'hooks' && ctx.path.length === 1) {
        return HOOK_EVENTS.map((e) => ({
          label: e,
          kind: CompletionItemKind.Event,
          detail: 'hook event',
          textEdit: edit(ctx, doc, `${e}:`),
        }));
      }
      return [];

    case 'bodySubst':
      return [...argumentCompletions(ctx, doc, spec), ...substitutionCompletions(ctx, doc, artifact)];

    case 'fmSubst':
      return substitutionCompletions(ctx, doc, artifact);

    default:
      return [];
  }
}

/** Hook events accepted in skill frontmatter, per the hooks reference. */
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'PostCompact',
] as const;
