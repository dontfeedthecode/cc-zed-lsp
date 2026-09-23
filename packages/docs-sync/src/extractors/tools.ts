import { findTable, unwrapCode } from '../pipeTable.ts';
import { absolutiseLinks } from '../links.ts';
import { FetchClassError } from '../fetch.ts';

export interface ExtractedTool {
  name: string;
  descriptionMarkdown: string;
}

/**
 * The canonical built-in tool list, straight from tools-reference.md.
 *
 * This is why `allowed-tools` completion needs no curation: the docs already
 * publish the list as a machine-readable table, so it stays current for free.
 */
export function extractTools(
  markdown: string,
  pageUrl: string,
  knownPages: ReadonlySet<string>,
): ExtractedTool[] {
  const lines = markdown.split('\n');
  const table = findTable(lines);
  if (!table) throw new FetchClassError('tools-reference.md contains no pipe table');

  const nameCol = table.headers.findIndex((h) => /^tool$/i.test(h));
  const descCol = table.headers.findIndex((h) => /^description$/i.test(h));
  if (nameCol < 0 || descCol < 0) {
    throw new FetchClassError(
      `tools-reference.md table headers changed: got [${table.headers.join(', ')}]`,
    );
  }

  const tools: ExtractedTool[] = [];
  for (const row of table.rows) {
    const name = unwrapCode(row[nameCol] ?? '');
    if (!name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
    const { markdown: desc } = absolutiseLinks(row[descCol] ?? '', pageUrl, knownPages);
    tools.push({ name, descriptionMarkdown: desc });
  }

  if (tools.length < 10) {
    throw new FetchClassError(`tools-reference.md yielded only ${tools.length} tools`);
  }
  return tools;
}
