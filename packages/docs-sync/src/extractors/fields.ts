import { findHeading, findTable, unwrapCode, codeTokens } from '../pipeTable.ts';
import { absolutiseLinks, type RewrittenLink } from '../links.ts';
import { FetchClassError } from '../fetch.ts';
import type { FieldTableSource } from '../sources.ts';

export interface ExtractedField {
  order: number;
  required: string;
  descriptionRaw: string;
  descriptionMarkdown: string;
  /**
   * Every backticked token in the description cell.
   *
   * This is NOT an enum and must never be used as one — `model`'s cell yields
   * tokens that are not values, and phrasing varies per field. It exists purely
   * so the drift checker can assert that each curated enum value still appears
   * upstream, and flag when a new token shows up in a field we have curated.
   */
  codeTokens: string[];
  links: RewrittenLink[];
}

export interface ExtractedArtifact {
  docsAnchor: string;
  fields: Record<string, ExtractedField>;
}

export function extractFields(
  markdown: string,
  source: FieldTableSource,
  knownPages: ReadonlySet<string>,
): ExtractedArtifact {
  const lines = markdown.split('\n');

  const headingLine = findHeading(lines, source.heading);
  if (headingLine < 0) {
    throw new FetchClassError(
      `${source.url}: heading "${source.heading}" not found — the page was restructured.`,
    );
  }

  const table = findTable(lines, headingLine);
  if (!table) {
    throw new FetchClassError(`${source.url}: no pipe table under "${source.heading}".`);
  }

  const fieldCol = table.headers.findIndex((h) => /^field$/i.test(h));
  const reqCol = table.headers.findIndex((h) => /^required$/i.test(h));
  const descCol = table.headers.findIndex((h) => /^description$/i.test(h));
  if (fieldCol < 0 || reqCol < 0 || descCol < 0) {
    throw new FetchClassError(
      `${source.url}: expected | Field | Required | Description |, got [${table.headers.join(', ')}]`,
    );
  }

  const fields: Record<string, ExtractedField> = {};
  let order = 0;
  for (const row of table.rows) {
    const name = unwrapCode(row[fieldCol] ?? '');
    if (!name || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) continue;

    const raw = row[descCol] ?? '';
    const { markdown: desc, links } = absolutiseLinks(raw, source.pageUrl, knownPages);

    fields[name] = {
      order: order++,
      required: (row[reqCol] ?? '').trim(),
      descriptionRaw: raw,
      descriptionMarkdown: desc,
      codeTokens: codeTokens(raw),
      links,
    };
  }

  if (Object.keys(fields).length < 5) {
    throw new FetchClassError(
      `${source.url}: table yielded only ${Object.keys(fields).length} fields.`,
    );
  }
  return { docsAnchor: `${source.pageUrl}#${source.anchor}`, fields };
}
